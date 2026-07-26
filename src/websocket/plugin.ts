// WebSocket Plugin
import type { Plugin } from '../core/plugin';
import type { VeloceTS } from '../core/application';
import { WebSocketManager } from './manager';

/**
 * Configuration options for {@link WebSocketPlugin}.
 * All fields are optional and have safe defaults.
 */
export interface WebSocketPluginConfig {
  /**
   * Interval in milliseconds between server-initiated heartbeat pings.
   * Set to `0` to disable the heartbeat entirely.
   *
   * On each tick the server sends a protocol-level ping when the runtime
   * exposes one (Bun's `ws.ping()`) plus a portable application-level
   * `{"type":"ping"}` JSON frame. Liveness is measured by ANY inbound
   * traffic — including the expected `{"type":"pong"}` reply — because
   * protocol-level pong events are not observable from the manager
   * (Bun delivers them to a `pong` handler on `Bun.serve()` which the
   * adapter does not wire, and Deno's upgraded sockets expose no `ping()`).
   * Clients should reply to `{"type":"ping"}` with `{"type":"pong"}` or
   * send any other message within `heartbeatTimeoutMs`.
   *
   * When the heartbeat is enabled, inbound `{"type":"ping"}` /
   * `{"type":"pong"}` frames are treated as reserved control messages and
   * are not forwarded to `@OnMessage` handlers.
   *
   * @default 30000
   */
  heartbeatIntervalMs?: number;

  /**
   * Maximum time in milliseconds a connection may go without any inbound
   * traffic before the heartbeat closes it (code 1001). Only effective
   * when `heartbeatIntervalMs > 0`.
   *
   * @default 2 * heartbeatIntervalMs
   */
  heartbeatTimeoutMs?: number;

  /**
   * Close connections (code 1001) that have received no inbound messages
   * for this many milliseconds. Unlike the heartbeat, this is a hard idle
   * cutoff: heartbeat pong replies still count as activity, so use a value
   * larger than `heartbeatIntervalMs` if both are enabled. `0` or
   * `undefined` disables the idle timeout.
   *
   * @default 0 (disabled)
   */
  idleTimeoutMs?: number;

  /**
   * Maximum inbound message size in bytes. Oversized messages cause an
   * error frame to be sent and the connection to be closed with code 1009
   * (Message Too Big). Enforced in the manager's message path because the
   * adapter's `Bun.serve()` websocket options (`maxPayloadLength`) are not
   * reachable from the plugin configuration.
   *
   * @default 1048576 (1 MiB)
   */
  maxMessageSizeBytes?: number;
}

/**
 * WebSocketPlugin adds WebSocket support to Veloce-TS
 * Registers WebSocket routes and handles connection upgrades
 */
export class WebSocketPlugin implements Plugin {
  name = 'websocket';
  version = '1.0.0';

  private manager: WebSocketManager;

  constructor(config: WebSocketPluginConfig = {}) {
    this.manager = new WebSocketManager(config);
  }

  async install(app: VeloceTS): Promise<void> {
    const isBun = typeof Bun !== 'undefined';
    const isDeno = typeof (globalThis as any).Deno !== 'undefined';
    if (!isBun && !isDeno) {
      throw new Error(
        'WebSocketPlugin requires Bun or Deno runtime. ' +
        'Node.js WebSocket support is not yet implemented in Veloce-TS. ' +
        'Run your app with Bun (https://bun.sh) or Deno.'
      );
    }

    const metadata = app.getMetadata();
    const websockets = metadata.getWebSockets();
    const container = app.getContainer();

    // Let the manager resolve gateway instances through the same DI container
    // the application uses, instead of instantiating targets directly.
    this.manager.setContainer(container);

    for (const ws of websockets) {
      ws.instance = await container.resolve(ws.target);
      this.registerWebSocket(app, ws);
    }
  }

  /**
   * Register a WebSocket route with the application
   */
  private registerWebSocket(app: VeloceTS, metadata: any): void {
    const hono = app.getHono();

    // Register WebSocket upgrade endpoint
    hono.get(metadata.path, async (c) => {
      // Check if this is a WebSocket upgrade request
      const upgrade = c.req.header('upgrade');

      if (upgrade?.toLowerCase() !== 'websocket') {
        return c.text('Expected WebSocket upgrade', 426);
      }

      // Optional pre-upgrade authorization. If the gateway exposes an
      // `authorizeUpgrade(c)` method, run it BEFORE switching protocols so an
      // unauthenticated client is rejected at the handshake (HTTP 401) instead
      // of completing the upgrade and being closed afterwards. Gateways that do
      // not define the method keep the previous behavior (upgrade always).
      const instance = metadata.instance;
      if (instance && typeof instance.authorizeUpgrade === 'function') {
        let authorized = false;
        try {
          authorized = await instance.authorizeUpgrade(c);
        } catch {
          authorized = false;
        }
        if (!authorized) {
          return c.text('Unauthorized', 401);
        }
      }

      // Handle WebSocket upgrade based on runtime
      return this.handleUpgrade(c, metadata);
    });
  }

  /**
   * Handle WebSocket upgrade for different runtimes
   */
  private handleUpgrade(c: any, metadata: any): Response {
    // Detect runtime and handle accordingly
    if (typeof Bun !== 'undefined') {
      return this.handleBunUpgrade(c, metadata);
    } else if (typeof (globalThis as any).Deno !== 'undefined') {
      return this.handleDenoUpgrade(c, metadata);
    } else {
      // Should never reach here — install() throws on Node.js before routes are registered.
      return c.text('WebSocket support requires Bun or Deno runtime', 501);
    }
  }

  /**
   * Handle WebSocket upgrade for Bun runtime
   *
   * Bun's WebSocket API requires that event handlers (open/message/close/error)
   * are provided as a `websocket` option to `Bun.serve()`. Because Veloce uses
   * Hono on top of Bun, we pass the manager callbacks via the upgrade `data`
   * object so they can be invoked from the Bun serve websocket handler.
   */
  private handleBunUpgrade(c: any, metadata: any): Response {
    const bunEnv = c.env as any;

    if (!bunEnv?.upgrade) {
      return c.text('WebSocket upgrade not supported in this environment', 501);
    }

    const success = bunEnv.upgrade(c.req.raw, {
      data: { manager: this.manager, metadata, requestUrl: c.req.url }
    });

    if (!success) {
      return c.text('WebSocket upgrade failed', 500);
    }

    // Bun has taken over the connection for WebSocket (101 already sent).
    // Return a Response to satisfy Hono's finalization requirement — Bun
    // ignores the fetch() return value after a successful upgrade().
    return new Response(null, { status: 101 });
  }

  /**
   * Handle WebSocket upgrade for Deno runtime
   *
   * Wires open/message/close/error symmetrically with the Bun path
   * (see the `websocket` handlers in the Hono adapter's `listenBun`).
   * Note: Deno's upgraded sockets expose no `ping()`, so the heartbeat
   * falls back to application-level `{"type":"ping"}` frames only.
   */
  private handleDenoUpgrade(c: any, metadata: any): Response {
    const Deno = (globalThis as any).Deno;
    const { socket, response } = Deno.upgradeWebSocket(c.req.raw);

    let connection: import('./connection').WebSocketConnection | undefined;

    socket.onopen = () => {
      connection = this.manager.openConnection(socket as any, metadata);
    };

    socket.onmessage = async (event: MessageEvent) => {
      if (connection) {
        await this.manager.handleMessage(event, connection, metadata);
      }
    };

    socket.onclose = () => {
      if (connection) {
        this.manager.handleDisconnect(connection, metadata);
      }
    };

    socket.onerror = (error: unknown) => {
      console.error('[WS] Deno WebSocket error:', error);
    };

    return response;
  }

  /**
   * Get the WebSocket manager instance
   */
  getManager(): WebSocketManager {
    return this.manager;
  }

  /**
   * Broadcast a message to all connections or a specific room
   */
  broadcast(message: any, room?: string): void {
    this.manager.broadcast(message, room);
  }

  /**
   * Get connection count
   */
  getConnectionCount(): number {
    return this.manager.getConnectionCount();
  }

  /**
   * Get all active rooms
   */
  getRooms(): string[] {
    return this.manager.getRooms();
  }
}
