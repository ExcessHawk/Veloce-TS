/**
 * @module veloce-ts/adapters/hono
 * @description {@link HonoAdapter}: detects the runtime (Bun/Node/Deno/Workers) and exposes `listen` over the Hono instance.
 */
import type { Hono } from 'hono';
import type { Adapter, ServerInstance } from './base.js';

// Type declarations for runtime globals
declare const Deno: any;
declare const Bun: any;

/**
 * Runtime detection utilities
 */
const detectRuntime = (): 'bun' | 'deno' | 'node' | 'workerd' | 'unknown' => {
  // Check for Bun
  if (typeof Bun !== 'undefined') {
    return 'bun';
  }

  // Check for Deno
  if (typeof Deno !== 'undefined') {
    return 'deno';
  }

  // Check for Cloudflare Workers
  if (typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers') {
    return 'workerd';
  }

  // Check for Node.js
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    return 'node';
  }

  return 'unknown';
};

/**
 * HonoAdapter - Adapts Hono.js to work across multiple runtimes
 * Automatically detects the runtime and uses the appropriate server implementation
 */
export class HonoAdapter implements Adapter {
  name = 'hono';
  private runtime: ReturnType<typeof detectRuntime>;

  constructor(private hono: Hono) {
    this.runtime = detectRuntime();
  }

  /**
   * Start the server on the specified port
   * Automatically uses the appropriate server for the detected runtime
   */
  async listen(port: number, callback?: () => void): Promise<ServerInstance> {
    switch (this.runtime) {
      case 'bun':
        return this.listenBun(port, callback);
      
      case 'deno':
        return this.listenDeno(port, callback);
      
      case 'node':
        return this.listenNode(port, callback);
      
      case 'workerd':
        throw new Error(
          'Cloudflare Workers do not support listen(). Deploy using wrangler or export the handler with getHandler().'
        );
      
      default:
        throw new Error(
          `Unsupported runtime: ${this.runtime}. Veloce-TS supports Bun, Node.js, Deno, and Cloudflare Workers.`
        );
    }
  }

  /**
   * Get the Hono fetch handler, bound to the Hono instance.
   *
   * This is the deploy path for serverless / edge runtimes that don't accept
   * an incoming-connection `listen()` — most notably **Cloudflare Workers**,
   * which invoke a `fetch(request, env, ctx)` export per-request instead.
   *
   * @example Cloudflare Workers entrypoint
   * ```ts
   * // worker.ts
   * const app = new VeloceTS({ title: 'My API' });
   * app.get('/hello', { handler: () => ({ message: 'hi' }) });
   * await app.compile();
   *
   * export default {
   *   fetch: app.getFetchHandler(),
   * };
   * ```
   */
  getHandler(): Hono['fetch'] {
    return this.hono.fetch.bind(this.hono);
  }

  /**
   * Get the detected runtime
   */
  getRuntime(): string {
    return this.runtime;
  }

  /**
   * Start server using Bun's native server
   * Passes the Bun server instance as `env` to Hono so WebSocketPlugin
   * can call server.upgrade() from within route handlers.
   */
  private listenBun(port: number, callback?: () => void): ServerInstance {
    const hono = this.hono;
    const server = Bun.serve({
      port,
      fetch(req: Request, bunServer: any) {
        // Pass the Bun server as `env` so c.env.upgrade() works in handlers,
        // and expose the server itself so `getConnInfo` (hono/bun) can read the
        // trusted peer IP — needed for IP-based rate limiting that must not
        // trust client-supplied X-Forwarded-For headers.
        return hono.fetch(req, { server: bunServer, upgrade: bunServer.upgrade.bind(bunServer) });
      },
      // Bun routes every socket through these four callbacks, so anything that
      // upgrades has to identify itself through `ws.data`. Sockets carrying
      // `handlers` (the GraphQL subscription endpoint, or any caller that needs
      // its own protocol) are dispatched there; the rest belong to
      // WebSocketPlugin's manager.
      websocket: {
        open(ws: any) {
          const { manager, metadata, handlers } = ws.data ?? {};
          if (handlers) {
            handlers.open?.(ws);
            return;
          }
          if (!manager || !metadata) return;
          const connection = manager.handleConnectionBun(ws, metadata);
          ws.data._connection = connection;
        },
        message(ws: any, message: string | Buffer) {
          const { manager, metadata, _connection, handlers } = ws.data ?? {};
          if (handlers) {
            handlers.message?.(ws, message);
            return;
          }
          if (!manager || !metadata || !_connection) return;
          manager.handleMessageBun(message, _connection, metadata);
        },
        close(ws: any, code: number, reason: string) {
          const { manager, metadata, _connection, handlers } = ws.data ?? {};
          if (handlers) {
            handlers.close?.(ws, code, reason);
            return;
          }
          if (!manager || !metadata || !_connection) return;
          manager.handleDisconnectBun(_connection, metadata);
        },
        error(ws: any, error: Error) {
          const { handlers } = ws.data ?? {};
          if (handlers?.error) {
            handlers.error(ws, error);
            return;
          }
          console.error('[WS] Bun WebSocket error:', error);
        },
      },
    });

    if (callback) {
      callback();
    }

    return {
      close: async () => {
        server.stop();
      },
      ...server,
      // Assigned after the spread, which only copies own enumerable properties:
      // `port` and `hostname` live on Bun's server prototype, so the spread
      // leaves the requested value in place. With `listen(0)` that is literally
      // 0, and a caller has no way to learn the port the OS actually assigned.
      port: server.port ?? port,
      raw: server,
    };
  }

  /**
   * Start server using Deno's native server
   */
  private listenDeno(port: number, callback?: () => void): ServerInstance {
    // Deno.serve returns a promise, so we handle it appropriately
    const ac = new AbortController();

    // The bound port is only known from onListen, which fires synchronously
    // during Deno.serve() — so reading it back afterwards is safe, and is the
    // only way a caller passing port 0 can learn what it got.
    let boundPort = port;

    const server = Deno.serve(
      {
        port,
        signal: ac.signal,
        onListen: (address: { port: number }) => {
          boundPort = address?.port ?? port;
          callback?.();
        }
      },
      this.hono.fetch
    );

    // Return an object with a close method for consistency
    return {
      port: boundPort,
      close: async () => {
        ac.abort();
      },
      raw: server,
    };
  }

  /**
   * Start server using Node.js adapter
   * Requires @hono/node-server package
   */
  private async listenNode(port: number, callback?: () => void): Promise<ServerInstance> {
    let serve: (options: any, callback?: () => void) => any;

    try {
      // @hono/node-server is an optional peer dependency: only Node users
      // calling listen() need it.
      //
      // This must be a dynamic import, not require(): the published ESM bundle
      // has no `require` in scope, so the old `require('@hono/node-server')`
      // threw ReferenceError under real Node — and the catch below reported it
      // as "package not installed" even when it was.
      //
      // The specifier is held in a variable so neither tsc nor the bundler
      // tries to resolve a package that is optional by design.
      const specifier = '@hono/node-server';
      ({ serve } = await import(specifier));
    } catch (error) {
      throw new Error(
        'Node.js adapter requires the @hono/node-server package. Install it with: npm install @hono/node-server',
        { cause: error }
      );
    }

    const server = serve(
      {
        fetch: this.hono.fetch,
        port,
      },
      callback
    );

    const address = typeof server.address === 'function' ? server.address() : undefined;

    return {
      close: async () => {
        return new Promise<void>((resolve) => {
          server.close(() => resolve());
        });
      },
      ...server,
      // See the Bun branch: with `listen(0)` the requested port is 0, and the
      // assigned one is only readable from the server's address().
      port: (address && typeof address === 'object' ? address.port : undefined) ?? port,
      // The spread above copies own enumerable properties, which drops the
      // http.Server prototype — so anything needing the real server object
      // (notably @hono/node-ws's injectWebSocket) cannot use the spread copy.
      // Keep an untouched reference. Assigned after the spread so a stray
      // `raw` property on the server cannot shadow it.
      raw: server,
    };
  }
}
