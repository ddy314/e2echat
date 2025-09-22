export class ChatRoom {
    constructor(state, env) {
        this.state = state;
        this.sessions = new Set();
        this.messages = [];
    }

    async fetch(request) {
        const url = new URL(request.url);
        if (request.headers.get('Upgrade') === 'websocket') {
            return this.handleWebSocket(request);
        }
        if (url.pathname === '/api/messages' && request.method === 'GET') {
            return new Response(JSON.stringify(this.messages), {
                headers: { 
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }
        
        return new Response('Not Found', { status: 404 });
    }

    async handleWebSocket(request) {
        const webSocketPair = new WebSocketPair();
        const client = webSocketPair[0];
        const server = webSocketPair[1];

        server.accept();
        this.sessions.add(server);
        
        server.addEventListener('message', event => {
            try {
                const data = JSON.parse(event.data);
                this.handleMessage(data, server);
            } catch (e) {
                console.error('消息解析失败:', e);
            }
        });

        server.addEventListener('close', () => {
            this.sessions.delete(server);
        });
        
        return new Response(null, { status: 101, webSocket: client });
    }

    handleMessage(data, sender) {
        // 修复：处理你的应用的消息格式
        if (data.type === 'chat') {
            const message = {
                id: data.id,
                text: data.text,
                from: data.from,
                ts: data.ts,
                type: 'chat'
            };
            this.messages.push(message);
            this.broadcast(message, sender);
        }
    }

    broadcast(message, excludeSender = null) {
        const messageStr = JSON.stringify(message);
        for (const session of this.sessions) {
            if (session !== excludeSender) {
                try {
                    session.send(messageStr);
                } catch (e) {
                    this.sessions.delete(session);
                }
            }
        }
    }
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const roomId = url.searchParams.get('room') || 'default';
        const durableObjectId = env.CHATROOM.idFromName(roomId);
        const chatroom = env.CHATROOM.get(durableObjectId);
        return chatroom.fetch(request);
    }
}