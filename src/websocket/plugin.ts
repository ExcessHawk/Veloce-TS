// WebSocket Plugin
import type { Plugin } from '../core/plugin.js';
import type { VeloceTS } from '../core/application.js';
import { WebSocketManager } from './manager.js';
import type { WebSocketConnection, WebSocketLike, WebSocketConnectionInit } from './connection.js';
import type { Context } from '../types/index.js';
import type { TokenPayload } from '../auth/jwt-provider.js';
import { InProcessSocket } from './in-process-socket.js';
import { getLogger } from '../logging/logger.js';
import {
  getNodeWebSocketAdapter,
  injectNodeWebSocket,
  needsNodeWebSocketAdapter,
  type NodeWebSocketAdapter,
} from './node-adapter.js';

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

  /**
   * How clients authenticate when a gateway asks for it
   * (`@WebSocket(path, { auth: true })`). Omit it and only the
   * `Authorization` header is considered and no extra route is registered.
   */
  auth?: WebSocketAuthConfig;
}

/** Where a WebSocket client's credentials may come from. */
export type WebSocketAuthSource = 'header' | 'ticket' | 'query';

/**
 * Storage for one-time connection tickets. The default keeps them in memory,
 * which is only correct for a single instance: with several, the instance that
 * issues a ticket is not necessarily the one that receives the upgrade, so
 * supply a shared implementation (Redis, a database table).
 */
export interface WebSocketTicketStore {
  /** Store `payload` under a fresh unguessable ticket valid for `ttlMs`. */
  issue(payload: TokenPayload, ttlMs: number): Promise<string>;
  /** Return the payload and invalidate the ticket; `null` if unknown, used or expired. */
  consume(ticket: string): Promise<TokenPayload | null>;
}

/** In-memory {@link WebSocketTicketStore}: per process, single use, expiring. */
export class MemoryWebSocketTicketStore implements WebSocketTicketStore {
  private tickets = new Map<string, { payload: TokenPayload; expiresAt: number }>();

  async issue(payload: TokenPayload, ttlMs: number): Promise<string> {
    const now = Date.now();
    // Opportunistic cleanup: tickets are short-lived, so this stays small.
    for (const [key, entry] of this.tickets) {
      if (entry.expiresAt <= now) this.tickets.delete(key);
    }

    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const ticket = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    this.tickets.set(ticket, { payload, expiresAt: now + ttlMs });
    return ticket;
  }

  async consume(ticket: string): Promise<TokenPayload | null> {
    const entry = this.tickets.get(ticket);
    if (!entry) return null;
    this.tickets.delete(ticket); // single use, whatever happens next
    return entry.expiresAt > Date.now() ? entry.payload : null;
  }
}

/** How WebSocket clients authenticate. */
export interface WebSocketAuthConfig {
  /**
   * Accepted credential sources, tried in order.
   *
   * - `header`: the `Authorization: Bearer` header. Works for server-to-server
   *   and native clients; browsers cannot set it on a WebSocket.
   * - `ticket`: a one-time ticket in the query string (`?ticket=…`). The
   *   client first calls the ticket endpoint with its normal credentials, then
   *   opens the socket with the ticket. The access token never appears in a
   *   URL, so it does not end up in proxy or server access logs.
   * - `query`: the access token itself in the query string (`?token=…`). Kept
   *   for compatibility; prefer `ticket`.
   *
   * @default ['header', 'ticket']
   */
  sources?: WebSocketAuthSource[];
  ticket?: {
    /** Lifetime of a ticket in milliseconds. @default 30000 */
    ttlMs?: number;
    /** Path of the endpoint that issues tickets; `false` to not register one. @default '/ws/ticket' */
    path?: string | false;
    /** Query parameter the client sends the ticket in. @default 'ticket' */
    param?: string;
    /** Where tickets are kept. @default an in-memory store (single instance only) */
    store?: WebSocketTicketStore;
  };
  /** Query parameter for the `query` source. @default 'token' */
  queryParam?: string;
  /**
   * Verify an access token. Defaults to the `AuthPlugin`'s JWT provider, so the
   * same secret, algorithm pinning and token blacklist apply.
   */
  verifyToken?: (token: string) => TokenPayload | Promise<TokenPayload>;
}

/** Header a TestClient uses to hand the plugin an in-process socket. Never honored without a pending test socket. */
const TEST_SOCKET_HEADER = 'x-veloce-test-socket';
/** Context key carrying the upgrade result to the Node (node-ws) handler factory. */
const UPGRADE_INIT_KEY = 'veloce:ws.init';

type UpgradeDecision =
  | { ok: true; init: WebSocketConnectionInit }
  | { ok: false; status: 401 | 403 };

/**
 * WebSocketPlugin adds WebSocket support to Veloce-TS
 * Registers WebSocket routes and handles connection upgrades
 */
export class WebSocketPlugin implements Plugin {
  name = 'websocket';
  version = '1.0.0';

  private manager: WebSocketManager;

  /** Set only on Node, where upgrades go through @hono/node-ws. */
  private nodeWs?: NodeWebSocketAdapter;

  private app?: VeloceTS;
  private readonly authConfig?: WebSocketAuthConfig;
  private readonly sources: WebSocketAuthSource[];
  private readonly ticketStore: WebSocketTicketStore;
  private readonly ticketTtlMs: number;

  /** In-process sockets waiting to be attached by an upgrade request (tests). */
  private pendingTestSockets = new Map<
    string,
    (opened: { connection: WebSocketConnection; metadata: any }) => void
  >();

  constructor(config: WebSocketPluginConfig = {}) {
    this.manager = new WebSocketManager(config);
    this.authConfig = config.auth;
    // Without an `auth` section nothing new is exposed: only the Authorization
    // header (already verified by the auth middleware) is considered.
    this.sources = config.auth ? config.auth.sources ?? ['header', 'ticket'] : ['header'];
    this.ticketStore = config.auth?.ticket?.store ?? new MemoryWebSocketTicketStore();
    this.ticketTtlMs = config.auth?.ticket?.ttlMs ?? 30_000;
  }

  async install(app: VeloceTS): Promise<void> {
    this.app = app;
    const container = app.getContainer();

    // Let the manager resolve gateway instances through the same DI container
    // the application uses, instead of instantiating targets directly.
    this.manager.setContainer(container);

    // Node has no built-in upgrade path, so it borrows @hono/node-ws. That has
    // to be wired up before any route is registered, because the routes
    // themselves are what the returned `upgradeWebSocket` middleware attaches to.
    if (needsNodeWebSocketAdapter()) {
      // Shared with the GraphQL subscription endpoint: two instances would
      // fight over the server's 'upgrade' event.
      this.nodeWs = await getNodeWebSocketAdapter(app);
    }

    this.registerTicketEndpoint(app);
  }

  /**
   * Register the gateway routes.
   *
   * Done here rather than in install() so the routes sit BEHIND every global
   * middleware — the auth middleware in particular, and the application's own
   * `afterPlugins` middleware. Registered during install() they came first and
   * `auth.user` was never set for an upgrade request.
   */
  async beforeCompile(app: VeloceTS): Promise<void> {
    const container = app.getContainer();

    for (const ws of app.getMetadata().getWebSockets()) {
      ws.instance = await container.resolve(ws.target);
      this.assertCanAuthenticate(ws);
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

    injectNodeWebSocket(app, raw);
  }

  // ==========================================================================
  // Authentication
  // ==========================================================================

  /** `POST /ws/ticket`: trade normal credentials for a one-time connection ticket. */
  private registerTicketEndpoint(app: VeloceTS): void {
    if (!this.sources.includes('ticket')) return;
    const path = this.authConfig?.ticket?.path ?? '/ws/ticket';
    if (path === false) return;

    app.post(path, {
      // Authenticated by the check below (it needs the user anyway); marked
      // public so `requireAuthByDefault` does not add a second, identical gate.
      public: true,
      handler: async (c: Context) => {
        const user = c.get('auth.user');
        if (!user) {
          return c.json({ error: 'Authentication required', statusCode: 401 }, 401);
        }

        // A ticket never outlives the token it was issued from.
        let ttlMs = this.ticketTtlMs;
        const exp = (user as { exp?: unknown }).exp;
        if (typeof exp === 'number') {
          ttlMs = Math.min(ttlMs, exp * 1000 - Date.now());
        }
        if (ttlMs <= 0) {
          return c.json({ error: 'Token expired', statusCode: 401 }, 401);
        }

        const ticket = await this.ticketStore.issue(user, ttlMs);
        return { ticket, expiresInMs: ttlMs };
      },
      docs: {
        summary: 'Issue a WebSocket connection ticket',
        description:
          'Returns a single-use, short-lived ticket. Open the WebSocket with `?ticket=<value>` ' +
          'instead of putting the access token in the URL.',
        tags: ['WebSocket']
      }
    });
  }

  /** A gateway that demands authentication needs something able to verify credentials. */
  private assertCanAuthenticate(metadata: any): void {
    const options = metadata.options;
    const managed = options?.auth === true || (options?.roles?.length ?? 0) > 0;
    if (!managed) return;

    if (!this.authConfig?.verifyToken && !this.app?.getPluginManager().getPlugin('auth')) {
      throw new Error(
        `WebSocket gateway "${metadata.target?.name ?? metadata.path}" requires authentication, but there is ` +
        'nothing to verify credentials with. Install AuthPlugin, or pass `auth.verifyToken` to WebSocketPlugin.'
      );
    }
  }

  private async verifyToken(token: string): Promise<TokenPayload | null> {
    try {
      if (this.authConfig?.verifyToken) {
        return await this.authConfig.verifyToken(token);
      }
      const authPlugin = this.app?.getPluginManager().getPlugin('auth') as any;
      const provider = authPlugin?.getAuthService?.().getJWTProvider?.();
      if (!provider) return null;
      return await provider.verifyAccessToken(token);
    } catch {
      return null;
    }
  }

  /** Identify the caller of an upgrade request from the configured sources. */
  private async authenticate(c: Context): Promise<TokenPayload | null> {
    for (const source of this.sources) {
      if (source === 'header') {
        // Usually already verified by the auth middleware…
        const user = c.get('auth.user');
        if (user) return user;
        // …but verify it here when that middleware is not installed.
        const header = c.req.header('authorization');
        if (header?.toLowerCase().startsWith('bearer ')) {
          const verified = await this.verifyToken(header.slice(7).trim());
          if (verified) return verified;
        }
      } else if (source === 'ticket') {
        const ticket = c.req.query(this.authConfig?.ticket?.param ?? 'ticket');
        if (ticket) {
          const payload = await this.ticketStore.consume(ticket);
          if (payload) return payload;
        }
      } else if (source === 'query') {
        const token = c.req.query(this.authConfig?.queryParam ?? 'token');
        if (token) {
          const verified = await this.verifyToken(token);
          if (verified) return verified;
        }
      }
    }
    return null;
  }

  /**
   * Decide whether an upgrade request may become a connection, and what the
   * connection will know about its client.
   *
   * 1. Identify the caller (header, ticket or query token).
   * 2. Enforce the gateway's declarative rules (`auth`, `roles`).
   * 3. Run the gateway's own `authorizeUpgrade(c)`; an object it returns
   *    becomes `connection.data`.
   */
  private async authorize(c: Context, metadata: any): Promise<UpgradeDecision> {
    const options = metadata.options ?? {};
    const roles: string[] = options.roles ?? [];
    const needsAuth = options.auth === true || roles.length > 0;

    const user = await this.authenticate(c);
    if (user && !c.get('auth.user')) {
      // Make the caller visible to authorizeUpgrade(), getCurrentUser(c), the
      // RBAC guard and anything else that reads the context.
      c.set('auth.user', user);
      c.set('auth.authenticated', true);
    }

    if (needsAuth && !user) {
      return { ok: false, status: 401 };
    }

    if (roles.length > 0 && user) {
      const rbac = this.app?.getPluginManager().getPlugin('rbac') as any;
      const guard = rbac?.getGuard?.();
      try {
        if (guard) {
          // Same path as an HTTP route: resolveRoles + inheritance
          await guard.resolveRequestRoles(c, user);
          guard.checkRoles(c, { roles, requireAll: false, allowInherited: true });
        } else if (!roles.some((role) => (user.roles ?? []).includes(role))) {
          return { ok: false, status: 403 };
        }
      } catch {
        return { ok: false, status: 403 };
      }
    }

    let data: unknown;
    const instance = metadata.instance;
    if (instance && typeof instance.authorizeUpgrade === 'function') {
      let result: unknown = false;
      try {
        result = await instance.authorizeUpgrade(c);
      } catch {
        result = false;
      }
      if (!result) {
        return { ok: false, status: 401 };
      }
      if (typeof result === 'object') {
        data = result;
      }
    }

    return { ok: true, init: { user: user ?? undefined, data } };
  }

  /**
   * Shared gate for every runtime: returns a Response when the request must not
   * (or, in tests, need not) reach the runtime's upgrade, otherwise what the
   * connection should be opened with.
   */
  private async gate(c: Context, metadata: any): Promise<Response | WebSocketConnectionInit> {
    const decision = await this.authorize(c, metadata);
    if (!decision.ok) {
      return c.text(decision.status === 403 ? 'Forbidden' : 'Unauthorized', decision.status);
    }

    // In-process connection for tests: only when this exact plugin instance is
    // waiting for the key the request carries.
    const testKey = c.req.header(TEST_SOCKET_HEADER);
    const attach = testKey ? this.pendingTestSockets.get(testKey) : undefined;
    if (testKey && attach) {
      this.pendingTestSockets.delete(testKey);
      const socket = new InProcessSocket(c.req.url);
      const connection = this.manager.openConnection(socket, metadata, decision.init);
      socket.bind(connection);
      attach({ connection, metadata });
      return c.json({ ok: true });
    }

    return decision.init;
  }

  /**
   * Open a connection to a gateway without a network socket (used by
   * `TestClient.ws()`). The request goes through the real route — global
   * middleware, authentication, `authorizeUpgrade` — and only the transport is
   * replaced. Rejects with `{ status }` when the upgrade is refused.
   */
  async connectInProcess(
    path: string,
    headers: Record<string, string> = {}
  ): Promise<{ connection: WebSocketConnection; metadata: any }> {
    if (!this.app) {
      throw new Error('WebSocketPlugin is not installed: call app.compile() first.');
    }

    const key = crypto.randomUUID();
    let opened: { connection: WebSocketConnection; metadata: any } | undefined;
    this.pendingTestSockets.set(key, (value) => {
      opened = value;
    });

    let response: Response;
    try {
      response = await this.app.getHono().request(path, {
        headers: { ...headers, Upgrade: 'websocket', Connection: 'Upgrade', [TEST_SOCKET_HEADER]: key },
      });
    } finally {
      this.pendingTestSockets.delete(key);
    }

    if (!opened) {
      const error = new Error(`WebSocket upgrade refused with status ${response.status}`) as Error & {
        status: number;
      };
      error.status = response.status;
      throw error;
    }
    return opened;
  }

  // ==========================================================================
  // Route registration and upgrades
  // ==========================================================================

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

      // Authorization runs BEFORE switching protocols, so a client that may not
      // connect is refused at the handshake (HTTP 401/403) instead of
      // completing the upgrade and being closed afterwards.
      const outcome = await this.gate(c, metadata);
      if (outcome instanceof Response) {
        return outcome;
      }

      // Handle WebSocket upgrade based on runtime
      return this.handleUpgrade(c, metadata, outcome);
    });
  }

  /**
   * Register a gateway on Node through @hono/node-ws.
   *
   * node-ws supplies a middleware that owns the route. It runs the application
   * for the upgrade request and only switches protocols if the response is its
   * own; any other response is written back to the socket as a plain HTTP
   * reply. So the gate runs as a middleware in front of it, and an unauthorized
   * client gets a 401/403 before the handshake, exactly as on Bun and Deno.
   */
  private registerNodeWebSocket(hono: any, metadata: any): void {
    const manager = this.manager;

    hono.get(
      metadata.path,
      async (c: Context, next: () => Promise<void>) => {
        if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') {
          return next();
        }
        const outcome = await this.gate(c, metadata);
        if (outcome instanceof Response) {
          return outcome;
        }
        (c as any).set(UPGRADE_INIT_KEY, outcome);
        return next();
      },
      this.nodeWs!.upgradeWebSocket((c: any) => {
        let connection: WebSocketConnection | undefined;
        const init: WebSocketConnectionInit | undefined = c.get(UPGRADE_INIT_KEY);

        return {
          async onOpen(_evt: unknown, ws: WebSocketLike) {
            connection = manager.openConnection(ws, metadata, init);
          },

          async onMessage(evt: { data: unknown }, _ws: WebSocketLike) {
            if (!connection) return;
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
  private handleUpgrade(c: any, metadata: any, init: WebSocketConnectionInit): Response {
    // Detect runtime and handle accordingly
    if (typeof Bun !== 'undefined') {
      return this.handleBunUpgrade(c, metadata, init);
    } else if (typeof (globalThis as any).Deno !== 'undefined') {
      return this.handleDenoUpgrade(c, metadata, init);
    } else {
      // Unreachable on Node: registerNodeWebSocket() owns those routes, so this
      // branch is only for a runtime that is none of the three.
      return c.text('WebSocket upgrades require Bun, Deno or Node with @hono/node-ws', 501);
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
  private handleBunUpgrade(c: any, metadata: any, init: WebSocketConnectionInit): Response {
    const bunEnv = c.env as any;

    if (!bunEnv?.upgrade) {
      return c.text('WebSocket upgrade not supported in this environment', 501);
    }

    const success = bunEnv.upgrade(c.req.raw, {
      data: { manager: this.manager, metadata, requestUrl: c.req.url, init }
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
  private handleDenoUpgrade(c: any, metadata: any, init: WebSocketConnectionInit): Response {
    const Deno = (globalThis as any).Deno;
    const { socket, response } = Deno.upgradeWebSocket(c.req.raw);

    let connection: import('./connection.js').WebSocketConnection | undefined;

    socket.onopen = () => {
      connection = this.manager.openConnection(socket as any, metadata, init);
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
