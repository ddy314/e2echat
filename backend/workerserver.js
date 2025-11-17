const encoder = new TextEncoder();

const json = (data, status = 200) =>
    new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
    });

const unauthorized = () => new Response("Unauthorized", { status: 401 });
const badRequest = (message = "Bad Request") => json({ error: message }, 400);

async function readJson(request) {
    try {
        return await request.json();
    } catch {
        return null;
    }
}

function base64UrlEncode(buffer) {
    const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
    let binary = "";
    for (const b of bytes) {
        binary += String.fromCharCode(b);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str) {
    const normalized = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
    const binary = atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

async function hmacKey(secret) {
    return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
        "sign",
        "verify",
    ]);
}

async function signJWT(payload, secret, ttlSeconds = 60 * 60 * 12) {
    const header = { alg: "HS256", typ: "JWT" };
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const body = { ...payload, exp };
    const base = `${base64UrlEncode(encoder.encode(JSON.stringify(header)))}.${base64UrlEncode(
        encoder.encode(JSON.stringify(body))
    )}`;
    const key = await hmacKey(secret);
    const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(base));
    return `${base}.${base64UrlEncode(signature)}`;
}

async function verifyJWT(token, secret) {
    const parts = token?.split(".");
    if (!parts || parts.length !== 3) return null;
    const [headerB64, payloadB64, signatureB64] = parts;
    try {
        const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(headerB64)));
        if (header.alg !== "HS256") return null;
        const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64)));
        if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
        const key = await hmacKey(secret);
        const valid = await crypto.subtle.verify(
            "HMAC",
            key,
            base64UrlDecode(signatureB64),
            encoder.encode(`${headerB64}.${payloadB64}`)
        );
        return valid ? payload : null;
    } catch {
        return null;
    }
}

function generateSalt() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return base64UrlEncode(bytes);
}

async function hashPassword(password, salt) {
    const data = encoder.encode(`${salt}:${password}`);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return base64UrlEncode(digest);
}

async function authenticate(request, secret) {
    const header = request.headers.get("Authorization");
    const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
    if (!token) return null;
    const payload = await verifyJWT(token, secret);
    if (!payload?.sub) return null;
    return payload;
}

class AccountDirectory {
    constructor(state, env) {
        this.state = state;
        this.env = env;
        this.ready = this.state.blockConcurrencyWhile(async () => {
            const stored = await this.state.storage.get("dir");
            this.users = stored?.users || {};
            this.rooms = stored?.rooms || {};
        });
    }

    async persist() {
        await this.state.storage.put("dir", { users: this.users, rooms: this.rooms });
    }

    async fetch(request) {
        await this.ready;
        const url = new URL(request.url);
        const { pathname, searchParams } = url;
        // CORS preflight support
        if (request.method === "OPTIONS") {
            return new Response(null, {
                status: 204,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type, Authorization",
                },
            });
        }

        if (pathname === "/api/auth/register" && request.method === "POST") {
            return this.register(request);
        }
        if (pathname === "/api/auth/login" && request.method === "POST") {
            return this.login(request);
        }
        if (pathname === "/api/profile" && request.method === "GET") {
            return this.profile(request);
        }
        if (pathname === "/api/friends/request" && request.method === "POST") {
            return this.friendRequest(request);
        }
        if (pathname === "/api/friends/respond" && request.method === "POST") {
            return this.friendRespond(request);
        }
        if (pathname === "/api/friends" && request.method === "GET") {
            return this.friendList(request);
        }
        if (pathname === "/api/rooms" && request.method === "POST") {
            return this.createRoom(request);
        }
        if (pathname === "/api/rooms" && request.method === "GET") {
            return this.listRooms(request);
        }
        if (pathname.startsWith("/internal/rooms/authorize") && request.method === "POST") {
            return this.authorizeRoom(request);
        }
        if (pathname === "/internal/rooms/bootstrap" && request.method === "POST") {
            return this.initRoom(request);
        }
        if (pathname === "/internal/users/public-keys" && request.method === "POST") {
            return this.lookupPublicKeys(request);
        }

        // Message history routing via directory to avoid exposing internals.
        if (pathname === "/api/messages" && request.method === "GET") {
            const roomId = searchParams.get("room");
            if (!roomId) return badRequest("room is required");
            return this.proxyToRoom(roomId, request);
        }
        if (pathname.startsWith("/api/messages/") && request.method === "DELETE") {
            const parts = pathname.split("/");
            const messageId = parts.pop();
            const roomId = parts.pop();
            if (!roomId || !messageId) return badRequest("room and message id are required");
            return this.proxyToRoom(roomId, request);
        }

        return new Response("Not Found", { status: 404 });
    }

    async register(request) {
        const body = await readJson(request);
        if (!body?.username || !body?.password) {
            return badRequest("username and password are required");
        }
        if (this.users[body.username]) {
            return badRequest("username already exists");
        }
        const salt = generateSalt();
        const hash = await hashPassword(body.password, salt);
        this.users[body.username] = {
            salt,
            hash,
            publicKey: body.publicKey || null, // client-managed E2E key
            friends: [],
            friendRequests: [],
            rooms: [],
        };
        await this.persist();
        const token = await signJWT({ sub: body.username }, this.env.JWT_SECRET);
        return json({ token, user: { username: body.username, publicKey: body.publicKey || null } });
    }

    async login(request) {
        const body = await readJson(request);
        if (!body?.username || !body?.password) {
            return badRequest("username and password are required");
        }
        const user = this.users[body.username];
        if (!user) return unauthorized();
        const hash = await hashPassword(body.password, user.salt);
        if (hash !== user.hash) return unauthorized();
        const token = await signJWT({ sub: body.username }, this.env.JWT_SECRET);
        return json({ token, user: { username: body.username, publicKey: user.publicKey } });
    }

    async profile(request) {
        const auth = await authenticate(request, this.env.JWT_SECRET);
        if (!auth) return unauthorized();
        const user = this.users[auth.sub];
        if (!user) return unauthorized();
        return json({
            username: auth.sub,
            publicKey: user.publicKey,
            friends: user.friends,
            friendRequests: user.friendRequests,
            rooms: user.rooms.map((id) => this.rooms[id]).filter(Boolean),
        });
    }

    async friendRequest(request) {
        const auth = await authenticate(request, this.env.JWT_SECRET);
        if (!auth) return unauthorized();
        const body = await readJson(request);
        if (!body?.to) return badRequest("to is required");
        const target = this.users[body.to];
        if (!target) return badRequest("user not found");
        if (target.friendRequests.includes(auth.sub) || target.friends.includes(auth.sub)) {
            return badRequest("already requested or friends");
        }
        target.friendRequests.push(auth.sub);
        await this.persist();
        return json({ ok: true });
    }

    async friendRespond(request) {
        const auth = await authenticate(request, this.env.JWT_SECRET);
        if (!auth) return unauthorized();
        const body = await readJson(request);
        if (!body?.from || typeof body.accept !== "boolean") return badRequest("from and accept are required");
        const user = this.users[auth.sub];
        const idx = user.friendRequests.indexOf(body.from);
        if (idx === -1) return badRequest("no pending request from user");
        user.friendRequests.splice(idx, 1);
        if (body.accept) {
            user.friends.push(body.from);
            this.users[body.from]?.friends.push(auth.sub);
        }
        await this.persist();
        return json({ ok: true });
    }

    async friendList(request) {
        const auth = await authenticate(request, this.env.JWT_SECRET);
        if (!auth) return unauthorized();
        const user = this.users[auth.sub];
        return json({ friends: user.friends, pending: user.friendRequests });
    }

    async createRoom(request) {
        const auth = await authenticate(request, this.env.JWT_SECRET);
        if (!auth) return unauthorized();
        const body = await readJson(request);
        const members = Array.from(new Set([auth.sub, ...(body?.members || [])]));
        if (!members.every((m) => this.users[m])) return badRequest("one or more members do not exist");

        const roomId = crypto.randomUUID();
        const room = {
            id: roomId,
            name: body?.name || "New Room",
            type: body?.type || "group", // group | direct
            members,
            createdBy: auth.sub,
            createdAt: Date.now(),
        };
        this.rooms[roomId] = room;
        members.forEach((m) => {
            const user = this.users[m];
            if (user && !user.rooms.includes(roomId)) user.rooms.push(roomId);
        });
        await this.persist();

        // Bootstrap the ChatRoom durable object with metadata.
        const chatroomId = this.env.CHATROOM.idFromName(roomId);
        const chatroom = this.env.CHATROOM.get(chatroomId);
        await chatroom.fetch("https://internal/internal/rooms/init", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(room),
        });

        return json({ room, websocket: `/ws/${roomId}` });
    }

    async listRooms(request) {
        const auth = await authenticate(request, this.env.JWT_SECRET);
        if (!auth) return unauthorized();
        const user = this.users[auth.sub];
        return json({ rooms: user.rooms.map((id) => this.rooms[id]).filter(Boolean) });
    }

    async authorizeRoom(request) {
        const auth = await authenticate(request, this.env.JWT_SECRET);
        if (!auth) return unauthorized();
        const body = await readJson(request);
        if (!body?.roomId) return badRequest("roomId required");
        const room = this.rooms[body.roomId];
        if (!room || !room.members.includes(auth.sub)) return unauthorized();
        return json({ ok: true, user: auth.sub });
    }

    async initRoom(request) {
        // Allows ChatRoom durable objects to refresh membership if needed.
        const body = await readJson(request);
        if (!body?.id) return badRequest("room id required");
        this.rooms[body.id] = body;
        await this.persist();
        return json({ ok: true });
    }

    async lookupPublicKeys(request) {
        const body = await readJson(request);
        if (!body?.users || !Array.isArray(body.users)) return badRequest("users array required");
        const keys = {};
        for (const u of body.users) {
            if (this.users[u]?.publicKey) keys[u] = this.users[u].publicKey;
        }
        return json({ keys });
    }

    async proxyToRoom(roomId, request) {
        const chatroomId = this.env.CHATROOM.idFromName(roomId);
        const chatroom = this.env.CHATROOM.get(chatroomId);
        return chatroom.fetch(request);
    }
}

class ChatRoom {
    constructor(state, env) {
        this.state = state;
        this.env = env;
        this.sessions = new Set();
        this.ready = this.state.blockConcurrencyWhile(async () => {
            const stored = await this.state.storage.get("room");
            this.meta = stored?.meta || { id: "unknown", members: [] };
            this.messages = stored?.messages || [];
        });
    }

    async persist() {
        await this.state.storage.put("room", { meta: this.meta, messages: this.messages });
    }

    async fetch(request) {
        await this.ready;
        const url = new URL(request.url);
        const { pathname, searchParams } = url;

        if (request.method === "OPTIONS") {
            return new Response(null, {
                status: 204,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type, Authorization",
                },
            });
        }

        if (request.headers.get("Upgrade") === "websocket") {
            return this.handleWebSocket(request);
        }

        if (pathname === "/api/messages" && request.method === "GET") {
            const user = await this.authorize(request);
            if (!user.ok) return user.resp;
            const limit = Number(searchParams.get("limit") || 100);
            const slice = this.messages.slice(-limit);
            return json({ room: this.meta, messages: slice });
        }

        if (pathname.includes("/api/messages/") && request.method === "DELETE") {
            const user = await this.authorize(request);
            if (!user.ok) return user.resp;
            const parts = pathname.split("/");
            const messageId = parts.pop();
            const msg = this.messages.find((m) => m.id === messageId);
            if (!msg) return new Response("Not Found", { status: 404 });
            // Only sender or room creator can delete.
            if (msg.from !== user.name && user.name !== this.meta.createdBy) return unauthorized();
            msg.deleted = true;
            msg.deletedAt = Date.now();
            await this.persist();
            this.broadcast({ type: "deleted", id: messageId, roomId: this.meta.id });
            return json({ ok: true });
        }

        if (pathname === "/internal/rooms/init" && request.method === "POST") {
            const body = await readJson(request);
            this.meta = body;
            await this.persist();
            return json({ ok: true });
        }

        return new Response("Not Found", { status: 404 });
    }

    async handleWebSocket(request) {
        const auth = await this.authorize(request);
        if (!auth.ok) return auth.resp;

        const pair = new WebSocketPair();
        const client = pair[0];
        const server = pair[1];
        server.accept();
        server.user = auth.name;
        this.sessions.add(server);

        server.addEventListener("message", async (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === "chat") {
                    const message = {
                        id: data.id || crypto.randomUUID(),
                        from: auth.name,
                        createdAt: Date.now(),
                        ciphertext: data.ciphertext,
                        keyHint: data.keyHint || null,
                        kind: data.kind || "text",
                        deleted: false,
                    };
                    this.messages.push(message);
                    await this.persist();
                    this.broadcast({ type: "chat", message });
                }
            } catch (err) {
                console.error("message parse error", err);
            }
        });

        server.addEventListener("close", () => {
            this.sessions.delete(server);
        });

        // send initial history limited to 50 for quick sync
        server.send(JSON.stringify({ type: "history", messages: this.messages.slice(-50) }));
        return new Response(null, { status: 101, webSocket: client });
    }

    async authorize(request) {
        const authz = request.headers.get("Authorization");
        const token = authz?.startsWith("Bearer ") ? authz.slice(7).trim() : new URL(request.url).searchParams.get("token");
        if (!token) return { ok: false, resp: unauthorized() };
        const payload = await verifyJWT(token, this.env.JWT_SECRET);
        if (!payload?.sub) return { ok: false, resp: unauthorized() };
        if (!this.meta.members.includes(payload.sub)) return { ok: false, resp: unauthorized() };
        return { ok: true, name: payload.sub };
    }

    broadcast(message) {
        const serialized = JSON.stringify(message);
        for (const session of Array.from(this.sessions)) {
            try {
                session.send(serialized);
            } catch (err) {
                this.sessions.delete(session);
            }
        }
    }
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        // WebSocket endpoint: /ws/:roomId
        if (url.pathname.startsWith("/ws/")) {
            const roomId = url.pathname.split("/")[2];
            if (!roomId) return badRequest("room id required");
            const chatroom = env.CHATROOM.get(env.CHATROOM.idFromName(roomId));
            return chatroom.fetch(request);
        }

        // Direct message operations for a room.
        if (url.pathname.startsWith("/api/messages")) {
            const roomId =
                url.searchParams.get("room") || url.pathname.split("/")[3] || url.pathname.split("/").pop();
            if (!roomId) return badRequest("room id required");
            const chatroom = env.CHATROOM.get(env.CHATROOM.idFromName(roomId));
            return chatroom.fetch(request);
        }

        // All other API routes go through the directory durable object.
        const directory = env.DIRECTORY.get(env.DIRECTORY.idFromName("directory"));
        return directory.fetch(request);
    },
};

export { AccountDirectory, ChatRoom };
