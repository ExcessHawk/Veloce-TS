/**
 * @module veloce-ts/testing/test-websocket
 * @description {@link TestWebSocket}: the client end of an in-process WebSocket, returned by `TestClient.ws()`.
 */
import type { WebSocketConnection } from '../websocket/connection.js';
import type { WebSocketManager } from '../websocket/manager.js';
import type { InProcessSocket } from '../websocket/in-process-socket.js';

/**
 * A connected test client for a `@WebSocket` gateway.
 *
 * Everything runs in-process: `send()` delivers a message to the gateway's
 * `@OnMessage` handler through the real {@link WebSocketManager} (size limit,
 * heartbeat frames, schema validation, rate limit), and whatever the gateway
 * sends back is collected here. No server, no port, no network.
 *
 * It exercises the framework's connection handling, not a runtime's WebSocket
 * transport — keep a smoke test against a real server for that.
 */
export class TestWebSocket {
  private cursor = 0;

  /** @internal */
  constructor(
    private readonly socket: InProcessSocket,
    private readonly manager: WebSocketManager,
    private readonly metadata: any,
    /** The server-side connection object, for assertions on `user`, `data`, rooms… */
    public readonly connection: WebSocketConnection
  ) {}

  /** Every frame the server has sent so far, JSON-parsed when possible. */
  get messages(): any[] {
    return this.socket.sent.map(parseFrame);
  }

  /** `true` once either side has closed the connection. */
  get closed(): boolean {
    return this.socket.closedWith !== null || !this.connection.isOpen;
  }

  /** Code the server closed the connection with, if it did. */
  get closeCode(): number | undefined {
    return this.socket.closedWith?.code;
  }

  /** Reason the server closed the connection with, if it did. */
  get closeReason(): string | undefined {
    return this.socket.closedWith?.reason;
  }

  /**
   * Send a message to the gateway and wait until its handler has finished.
   * Objects are JSON-encoded, strings are sent as-is.
   */
  async send(data: unknown): Promise<void> {
    if (this.closed) {
      throw new Error('Cannot send on a closed test WebSocket');
    }
    const raw = typeof data === 'string' ? data : JSON.stringify(data);
    await this.manager.handleMessage({ data: raw } as MessageEvent, this.connection, this.metadata);
  }

  /**
   * The next frame from the server that has not been returned by a previous
   * `nextMessage()` call. Resolves immediately when one is already waiting.
   *
   * @param timeoutMs - How long to wait before rejecting. @default 1000
   */
  nextMessage(timeoutMs: number = 1000): Promise<any> {
    return new Promise((resolve, reject) => {
      const take = (): boolean => {
        if (this.cursor < this.socket.sent.length) {
          resolve(parseFrame(this.socket.sent[this.cursor++]));
          return true;
        }
        return false;
      };

      if (take()) return;

      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error(`No WebSocket message received within ${timeoutMs} ms`));
      }, timeoutMs);

      const unsubscribe = this.socket.onActivity(() => {
        if (take()) {
          clearTimeout(timer);
          unsubscribe();
        } else if (this.socket.closedWith) {
          clearTimeout(timer);
          unsubscribe();
          reject(new Error(`WebSocket closed (${this.socket.closedWith.code ?? 'no code'}) while waiting for a message`));
        }
      });
    });
  }

  /** Close the connection from the client side; runs the gateway's `@OnDisconnect`. */
  async close(): Promise<void> {
    if (!this.connection.isOpen) return;
    this.socket.readyState = 3;
    this.manager.handleDisconnect(this.connection, this.metadata);
    // Let an async @OnDisconnect handler settle before the test continues
    await Promise.resolve();
  }
}

function parseFrame(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
