// 消息处理服务

import { sendMessage as wsSendMessage } from "../net/socket";

// 格式化消息
export function formatMessage(msg, role) {
    return {
        id: `${Date.now()}`,
        text: msg,
        role,
        ts: new Date().toISOString()
    };
}

// 通过WebSocket发送消息
export function sendPipeline(msg) {
    const messageData = {
        id: `${Date.now()}`,
        version: '1.0',
        from: 'me',
        ts: new Date().toISOString(),
        text: msg,
        type: 'chat'
    };
    const success = wsSendMessage(messageData);
    if (success) {
        return Promise.resolve(messageData);
    } else {
        return Promise.reject(new Error('WebSocket is not connected'));
    }
}


// 发送消息（返回UI格式的消息）
export async function sendMessage(msg) {
    await sendPipeline(msg);
    return formatMessage(msg, 'me');
}