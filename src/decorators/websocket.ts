// WebSocket decorators
import 'reflect-metadata';
import type { ZodSchema } from 'zod';
import { MetadataRegistry } from '../core/metadata.js';
import type { WebSocketGatewayOptions } from '../types/index.js';

/**
 * @WebSocket decorator - Marks a class as a WebSocket handler
 * @param path - WebSocket endpoint path
 * @param options - Optional access rules and limits. `{ auth: true }` refuses
 *   the upgrade with 401 unless the client is authenticated, and exposes the
 *   user as `connection.user`; see {@link WebSocketGatewayOptions}.
 * 
 * @example
 * ```typescript
 * @WebSocket('/ws/chat')
 * class ChatHandler {
 *   @OnConnect()
 *   handleConnect(connection: WebSocketConnection) {
 *     console.log('Client connected');
 *   }
 * }
 * ```
 */
export function WebSocket(path: string, options?: WebSocketGatewayOptions): ClassDecorator {
  return (target: any) => {
    MetadataRegistry.defineWebSocket(target, options ? { path, options } : { path });
  };
}

/**
 * @OnConnect decorator - Marks a method to be called when a client connects
 * 
 * @example
 * ```typescript
 * @OnConnect()
 * handleConnect(connection: WebSocketConnection) {
 *   connection.send({ type: 'welcome', message: 'Connected!' });
 * }
 * ```
 */
export function OnConnect(): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    MetadataRegistry.defineWebSocketHandler(target, propertyKey as string, {
      type: 'connect',
      method: propertyKey as string
    });
  };
}

/**
 * @OnMessage decorator - Marks a method to be called when a message is received
 * @param schema - Optional Zod schema for message validation
 * 
 * @example
 * ```typescript
 * const MessageSchema = z.object({
 *   type: z.string(),
 *   content: z.string()
 * });
 * 
 * @OnMessage(MessageSchema)
 * handleMessage(connection: WebSocketConnection, data: z.infer<typeof MessageSchema>) {
 *   connection.broadcast(data);
 * }
 * ```
 */
export function OnMessage(schema?: ZodSchema): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    MetadataRegistry.defineWebSocketHandler(target, propertyKey as string, {
      type: 'message',
      method: propertyKey as string,
      schema
    });
  };
}

/**
 * @OnDisconnect decorator - Marks a method to be called when a client disconnects
 * 
 * @example
 * ```typescript
 * @OnDisconnect()
 * handleDisconnect(connection: WebSocketConnection) {
 *   console.log('Client disconnected');
 * }
 * ```
 */
export function OnDisconnect(): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    MetadataRegistry.defineWebSocketHandler(target, propertyKey as string, {
      type: 'disconnect',
      method: propertyKey as string
    });
  };
}
