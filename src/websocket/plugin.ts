// WebSocket Plugin
import type { Plugin } from '../core/plugin.js';
import type { VeloceTS } from '../core/application.js';
import { WebSocketManager } from './manager.js';
import type { WebSocketConnection, WebSocketLike } from './connection.js';
import { getLogger } from '../logging/logger.js';

const isBunRuntime = (): boolean => typeof (globalThis as any).Bun !== 'undefined';
const isDenoRuntime = (): boolean => typeof (globalThis as any).Deno !== 'undefined';

/** The slice of `@hono/node-ws` this plugin uses. */
interface NodeWebSocketLike {
  upgradeWebSocket: (handler: (c: any) => Record<string, unknown>) => any;
  injectWebSocket: (server: unknown) => void;
}

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

  /** Set only on Node, where upgrades go through @hono/node-ws. */
  private nodeWs?: NodeWebSocketLike;

  constructor(config: WebSocketPluginConfig = {}) {
    this.manager = new WebSocketManager(config);
  }

  async install(app: VeloceTS): Promise<void> {
    const metadata = app.getMetadata();
    const websockets = metadata.getWebSockets();
    const container = app.getContainer();

    // Let the manager resolve gateway instances through the same DI container
    // the application uses, instead of instantiating targets directly.
    this.manager.setContainer(container);

    // Node has no built-in upgrade path, so it borrows @hono/node-ws. That has
    // to be wired up before any route is registered, because the routes
    // themselves are what the returned `upgradeWebSocket` middleware attaches to.
    if (!isBunRuntime() && !isDenoRuntime()) {
      await this.setupNodeWebSockets(app);
    }

    for (const ws of websockets) {
      ws.instance = await container.resolve(ws.target);
      this.registerWebSocket(app, ws);
    }
  }

  /**
   * Attach the WebSocket server to the running HTTP server.
   *
   * `@hono/node-ws` needs the real `http.Server`, which only exists once
   * `listen()` has run — hence `onStart`, which fires after the server is
   * accepting connections.
   */
  async onStart(app: VeloceTS): Promise<void> {
    if (!this.nodeWs) return;

    const server = app.getServer();
    const raw = server?.raw ?? server;
    if (!raw) {
      throw new Error(
        'WebSocketPlugin could not reach the HTTP server to attach WebSocket support. ' +
        'This is expected when the app is served through getFetchHandler() instead of listen(); ' +
        'WebSocket upgrades need a real server.'
      );
    }

    this.nodeWs.injectWebSocket(raw as any);
  }

  /**
   * Load @hono/node-ws and keep its `upgradeWebSocket` middleware for the route
   * registration that follows.
   */
  private async setupNodeWebSockets(app: VeloceTS): Promise<void> {
    let createNodeWebSocket: (init: { app: any }) => NodeWebSocketLike;

    try {
      // Specifier in a variable: the package is an optional peer, so neither tsc
      // nor the bundler should try to resolve it at build time.
      const specifier = '@hono/node-ws';
      ({ createNodeWebSocket } = await import(specifier));
    } catch (error) {
      throw new Error(
        'WebSocket support on Node requires the @hono/node-ws package. ' +
        'Install it with: npm install @hono/node-ws\n' +
        '(Bun and Deno upgrade natively and need no extra package.)',
        { cause: error }
      );
    }

    this.nodeWs = createNodeWebSocket({ app: app.getHono() });
  }

  /**
   * Register a WebSocket route with the application
   */
  private registerWebSocket(app: VeloceTS, metadata: any): void {
    const hono = app.getHono();

    if (this.nodeWs) {
      this.registerNodeWebSocket(hono, metadata);
      return;
    }

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
   * Register a gateway on Node through @hono/node-ws.
   *
   * Unlike Bun and Deno — where the handler decides at request time whether to
   * upgrade — node-ws supplies a middleware that owns the route, so the
   * `authorizeUpgrade` check has to run inside its handler factory. Returning
   * no event handlers is how a rejected connection is expressed there.
   */
  private registerNodeWebSocket(hono: any, metadata: any): void {
    const manager = this.manager;

    hono.get(
      metadata.path,
      this.nodeWs!.upgradeWebSocket((c: any) => {
        let connection: WebSocketConnection | undefined;
        let authorized = true;

        return {
          async onOpen(_evt: unknown, ws: WebSocketLike) {
            const instance = metadata.instance;
            if (instance && typeof instance.authorizeUpgrade === 'function') {
              try {
                authorized = Boolean(await instance.authorizeUpgrade(c));
              } catch {
                authorized = false;
              }
              if (!authorized) {
                // 1008 = Policy Violation. The handshake already completed by
                // the time node-ws hands us the socket, so an unauthorized
                // client is closed here rather than refused with a 401.
                ws.close(1008, 'Unauthorized');
                return;
              }
            }
            connection = manager.openConnection(ws, metadata);
          },

          async onMessage(evt: { data: unknown }, _ws: WebSocketLike) {
            if (!authorized || !connection) return;
            await manager.handleMessage(evt as MessageEvent, connection, metadata);
          },

          onClose() {
            if (connection) {
              manager.handleDisconnect(connection, metadata);
              connection = undefined;
            }
          },

          onError(error: unknown) {
            getLogger().error(
              'WebSocket transport error',
              error instanceof Error ? error : new Error(String(error)),
              { path: metadata.path, connectionId: connection?.id }
            );
          },
        };
      })
    );
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

    let connection: import('./connection.js').WebSocketConnection | undefined;

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
