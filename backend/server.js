const { WebSocketServer } = require('ws');
const PORT = 11451;

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', ws => {
    console.log('客户端已连接');
    
    ws.on('message', message => {
        // 将Buffer转换为字符串
        const messageStr = message.toString('utf8');
        console.log('接收到消息:', messageStr);
        
        try {
            // 尝试解析JSON
            const messageData = JSON.parse(messageStr);
            console.log('解析后的消息:', messageData);
            
            // 转发给其他所有客户端
            for (const client of wss.clients) {
                if (client !== ws && client.readyState === client.OPEN) {
                    // 发送字符串而不是Buffer
                    client.send(messageStr);
                }
            }
        } catch (error) {
            console.error('JSON解析失败:', error);
            // 如果不是JSON，直接转发字符串
            for (const client of wss.clients) {
                if (client !== ws && client.readyState === client.OPEN) {
                    client.send(messageStr);
                }
            }
        }
    });
    
    ws.on('close', () => {
        console.log('客户端已断开连接');
    });
    
    ws.on('error', (err) => {
        console.error('WebSocket错误:', err);
    });
});

wss.on('listening', () => {
    console.log(`WebSocket服务器正在监听端口 ${PORT}`);
});

wss.on('error', (err) => {
    console.error('服务器错误:', err);
});
