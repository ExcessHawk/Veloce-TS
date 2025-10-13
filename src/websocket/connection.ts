// WebSocket connection wrapper
import type { WebSocketManager } from './manager';

/**
 * WebSocketConnection wraps a native WebSocket with helper methods
 * for sending messages, broadcasting, and managing rooms
 */
export class WebSocketConnection {
  public readonly id: string;
  private _ws: WebSocket | null;

  constructor(
    ws: WebSocket,
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
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
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
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.close(code, reason);
    }
  }

  /**
   * Get the native WebSocket instance
   */
  get native(): WebSocket | null {
    return this._ws;
  }

  /**
   * Check if the connection is open
   */
  get isOpen(): boolean {
    return this._ws !== null && this._ws.readyState === WebSocket.OPEN;
  }

  /**
   * Internal method to mark connection as closed
   */
  _markClosed(): void {
    this._ws = null;
  }
}
