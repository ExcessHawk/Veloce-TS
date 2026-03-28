/**
 * @module veloce-ts/websocket
 * @description Conexión, manager, plugin y decoradores `@WebSocket` / `@OnMessage`, etc.
 */
export { WebSocketConnection } from './connection';
export { WebSocketManager } from './manager';
export { WebSocketPlugin } from './plugin';

// WebSocket decorators exports
export {
  WebSocket,
  OnConnect,
  OnMessage,
  OnDisconnect
} from '../decorators/websocket';