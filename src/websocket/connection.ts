// WebSocket connection wrapper
import type { WebSocketManager } from './manager.js';

/**
 * `readyState` value for an open socket (RFC 6455 / WHATWG).
 *
 * Hardcoded rather than read from a global `WebSocket.OPEN`: the global only
 * became stable in Node 22, so on Node 20 — which `engines` still supports —
 * touching it throws a ReferenceError. The numeric values are fixed by the
 * standard and are identical across Bun, Deno, `ws` and browsers.
 */
const OPEN = 1;

/**
 * The subset of a socket this wrapper actually uses. Deliberately structural so
 * it fits a Bun socket, a Deno one, and the `WSContext` that `@hono/node-ws`
 * hands us on Node.
 */
export interface WebSocketLike {
  readyState: number;
  send(data: string | ArrayBufferLike | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
  ping?(): void;
  [key: string]: any;
}

/**
 * WebSocketConnection wraps a native WebSocket with helper methods
 * for sending messages, broadcasting, and managing rooms
 */
export class WebSocketConnection {
  public readonly id: string;
  private _ws: WebSocketLike | null;

  constructor(
    ws: WebSocketLike,
    private manager: WebSocketManager,
    id?: string
  ) {
    this._ws = ws;
    this.id = id || crypto.randomUUID();
  }

  /**
   * Send a message to this specific connection
   * @param data - Data to send (will be JSON stringified)
   */
  send(data: any): void {
    if (!this._ws || this._ws.readyState !== OPEN) {
      return;
    }

    const message = typeof data === 'string' ? data : JSON.stringify(data);
    this._ws.send(message);
  }

  /**
   * Broadcast a message to all connections in a room (or all connections if no room specified)
   * @param data - Data to broadcast
   * @param room - Optional room name to broadcast to
   */
  broadcast(data: any, room?: string): void {
    this.manager.broadcast(data, room);
  }

  /**
   * Join a room
   * @param room - Room name to join
   */
  join(room: string): void {
    this.manager.joinRoom(this.id, room);
  }

  /**
   * Leave a room
   * @param room - Room name to leave
   */
  leave(room: string): void {
    this.manager.leaveRoom(this.id, room);
  }

  /**
   * Close the WebSocket connection
   * @param code - Optional close code
   * @param reason - Optional close reason
   */
  close(code?: number, reason?: string): void {
    if (this._ws && this._ws.readyState === OPEN) {
      this._ws.close(code, reason);
    }
  }

  /**
   * Get the native WebSocket instance
   */
  get native(): WebSocketLike | null {
    return this._ws;
  }

  /**
   * Get the original request URL for this connection.
   * In Bun, the URL is stored in ws.data.requestUrl (set by WebSocketPlugin).
   * Falls back to the ws.url property for standard WebSocket environments.
   */
  get requestUrl(): string {
    if (!this._ws) return '';
    const ws = this._ws as any;
    return ws?.data?.requestUrl ?? ws?.url ?? '';
  }

  /**
   * Check if the connection is open
   */
  get isOpen(): boolean {
    return this._ws !== null && this._ws.readyState === OPEN;
  }

  /**
   * Internal method to mark connection as closed
   */
  _markClosed(): void {
    this._ws = null;
  }
}
