const buildWsUrl = (roomId, token) => {
    const raw = (import.meta.env.VITE_WEBSOCKET_URL || "").trim();
    const host = raw || window.location.origin.replace(/^http/, "ws");
    const normalized = host.endsWith("/") ? host.slice(0, -1) : host;

    let url = normalized;
    if (url.includes("{room}")) {
        url = url.replace("{room}", roomId);
    } else if (/\/ws\/[^/?#]+/.test(url)) {
        url = url.replace(/\/ws\/[^/?#]+/, `/ws/${roomId}`);
    } else {
        url = `${url}/ws/${roomId}`;
    }

    if (token) {
        url += (url.includes("?") ? "&" : "?") + `token=${encodeURIComponent(token)}`;
    }
    return url;
};

export function createRoomSocket(roomId, token, callbacks = {}) {
    const { onHistory, onChat, onDeleted, onOpen, onClose, onError } = callbacks;
    const url = buildWsUrl(roomId, token);
    const ws = new WebSocket(url);

    ws.addEventListener("open", () => onOpen?.());
    ws.addEventListener("close", () => onClose?.());
    ws.addEventListener("error", (err) => onError?.(err));
    ws.addEventListener("message", (event) => {
        try {
            const payload = JSON.parse(event.data);
            if (payload?.type === "history" && Array.isArray(payload.messages)) {
                onHistory?.(payload.messages);
            } else if (payload?.type === "chat" && payload.message) {
                onChat?.(payload.message);
            } else if (payload?.type === "deleted" && payload.id) {
                onDeleted?.(payload.id);
            }
        } catch {
            // ignore malformed packet
        }
    });

    const sendChat = (data) => {
        if (ws.readyState !== WebSocket.OPEN) {
            throw new Error("Connection is not open");
        }
        ws.send(JSON.stringify({ type: "chat", ...data }));
    };

    const dispose = () => {
        ws.close();
    };

    return { ws, sendChat, dispose };
}
