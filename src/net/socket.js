let ws = null;

// 修改：使用环境变量或配置来管理不同环境的URL
const getWebSocketUrl = () => {
    // 使用Vite定义的环境变量
    return import.meta.env.VITE_WEBSOCKET_URL || (import.meta.env.PROD ? 'wss://your-worker.your-subdomain.workers.dev' : 'ws://localhost:11451');
};

export function connect(url = getWebSocketUrl()) {
    return new Promise((resolve, reject) => {
        if (ws) {
            ws.close();
        }
        ws = new WebSocket(url);
        
        ws.onopen = () => {
            console.log('WebSocket connected to:', url);
            resolve(ws);
        };
        
        ws.onerror = (err) => {
            console.error('WebSocket error:', err);
            reject(err);
        };
        
        ws.onclose = () => {
            console.log('WebSocket disconnected');
            ws = null;
        };
    });
}

// 其他函数保持不变
export function sendMessage(message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        const data = JSON.stringify(message);
        ws.send(data);
        return true;
    }
    console.error('WebSocket is not connected');
    return false;
}

export function onMessage(callback) {
    if (ws) {
        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                callback(data);
            } catch (e) {
                callback(event.data);
            }
        };
    }
}

export function disconnect() {
    if (ws) {
        ws.close();
        ws = null;
    }
}

export function isConnected() {
    return ws && ws.readyState === WebSocket.OPEN;
}