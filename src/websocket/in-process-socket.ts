/**
 * @module veloce-ts/websocket/in-process-socket
 * @description A socket with no network behind it, used to drive a gateway from tests.
 */
import type { WebSocketConnection, WebSocketLike } from './connection.js';

/** RFC 6455 ready states (hardcoded: the global `WebSocket` is not available on every supported runtime). */
const OPEN = 1;
const CLOSED = 3;

/**
 * Server-side end of an in-process WebSocket.
 *
 * Whatever the gateway sends is recorded instead of written to a wire, and a
 * server-initiated close is remembered with its code and reason. It carries
 * `data.requestUrl` the way Bun's sockets do, so `connection.requestUrl` works.
 */
export class InProcessSocket implements WebSocketLike {
  readyState = OPEN;
  readonly data: { requestUrl: string };

  /** Frames the server sent, in order, as raw strings. */
  readonly sent: string[] = [];
  /** Set when the server closed the connection. */
  closedWith: { code?: number; reason?: string } | null = null;

  private connection?: WebSocketConnection;
  private listeners = new Set<() => void>();

  constructor(requestUrl: string) {
    this.data = { requestUrl };
  }

  /** @internal */
  bind(connection: WebSocketConnection): void {
    this.connection = connection;
  }

  /** @internal The connection the manager created for this socket. */
  getConnection(): WebSocketConnection | undefined {
    return this.connection;
  }

  send(data: string | ArrayBufferLike | ArrayBufferView): void {
    this.sent.push(typeof data === 'string' ? data : new TextDecoder().decode(data as ArrayBuffer));
    this.notify();
  }

  close(code?: number, reason?: string): void {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    this.closedWith = { code, reason };
    this.notify();
  }

  /** Run `listener` whenever a frame is sent or the socket closes. Returns an unsubscribe function. */
  onActivity(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of Array.from(this.listeners)) listener();
  }
}
