/**
 * @module veloce-ts/websocket
 * @description Connection, manager, plugin and the `@WebSocket` / `@OnMessage` decorators.
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