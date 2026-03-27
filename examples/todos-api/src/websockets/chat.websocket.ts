import { WebSocket, OnConnect, OnMessage, OnDisconnect } from 'veloce-ts/websocket';
import { z } from 'zod';
import type { WebSocketConnection } from 'veloce-ts/websocket';

const MessageSchema = z.object({
  type: z.enum(['message', 'join', 'leave']),
  content: z.string(),
  username: z.string(),
});

@WebSocket('/ws/chat')
export class ChatWebSocket {
  @OnConnect()
  handleConnect(connection: WebSocketConnection) {
    console.log('Client connected:', connection.id);
    connection.send({ type: 'system', content: 'Welcome to the chat!' });
  }

  @OnMessage(MessageSchema)
  async handleMessage(connection: WebSocketConnection, message: z.infer<typeof MessageSchema>) {
    console.log('Received message:', message);
    
    // Broadcast to all clients
    connection.broadcast({
      type: 'message',
      username: message.username,
      content: message.content,
      timestamp: new Date().toISOString(),
    });
  }

  @OnDisconnect()
  handleDisconnect(connection: WebSocketConnection) {
    console.log('Client disconnected:', connection.id);
  }
}
