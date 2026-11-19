/**
 * @module veloce-ts/websocket
 * @description Connection, manager, plugin and the `@WebSocket` / `@OnMessage` decorators.
 */
export { WebSocketConnection, type WebSocketConnectionInit, type WebSocketGateway } from './connection.js';
export { WebSocketManager } from './manager.js';
export {
  WebSocketPlugin,
  MemoryWebSocketTicketStore,
  type WebSocketPluginConfig,
  type WebSocketAuthConfig,
  type WebSocketTicketStore,
} from './plugin.js';

// WebSocket decorators exports
export {
  WebSocket,
  OnConnect,
  OnMessage,
  OnDisconnect
} from '../decorators/websocket.js';