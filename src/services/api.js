const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");

const toJson = async (resp) => {
    const text = await resp.text();
    return text ? JSON.parse(text) : null;
};

async function request(path, { method = "GET", data, token } = {}) {
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const resp = await fetch(`${API_BASE}${path}`, {
        method,
        headers,
        body: data ? JSON.stringify(data) : undefined,
    });
    const body = await toJson(resp);
    if (!resp.ok) {
        const message = body?.error || resp.statusText;
        throw new Error(message);
    }
    return body;
}

export const api = {
    register(payload) {
        return request("/api/auth/register", { method: "POST", data: payload });
    },
    login(payload) {
        return request("/api/auth/login", { method: "POST", data: payload });
    },
    profile(token) {
        return request("/api/profile", { token });
    },
    friends(token) {
        return request("/api/friends", { token });
    },
    sendFriendRequest(token, to) {
        return request("/api/friends/request", { method: "POST", data: { to }, token });
    },
    respondFriendRequest(token, from, accept) {
        return request("/api/friends/respond", { method: "POST", data: { from, accept }, token });
    },
    createRoom(token, data) {
        return request("/api/rooms", { method: "POST", data, token });
    },
    listRooms(token) {
        return request("/api/rooms", { token });
    },
    getMessages(token, roomId, limit = 120) {
        return request(`/api/messages?room=${encodeURIComponent(roomId)}&limit=${limit}`, { token });
    },
    deleteMessage(token, roomId, messageId) {
        return request(`/api/messages/${roomId}/${messageId}`, { method: "DELETE", token });
    },
};
