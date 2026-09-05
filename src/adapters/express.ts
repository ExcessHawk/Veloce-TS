/**
 * @module veloce-ts/adapters/express
 * @description {@link ExpressAdapter}: mounts the internal Hono app behind Express, forwarding each request to `fetch` and copying the `Response` back.
 *
 * Express adapter for Veloce-TS
 *
 * Bridges Veloce-TS / Hono routes into an existing Express application.
 * The adapter works by forwarding every request received by Express to
 * Hono's `fetch()` handler and then writing the Web-standard `Response`
 * back through Express's `res` object.
 *
 * Express is a **peer dependency** — install it separately:
 *   npm install express
 *   npm install --save-dev @types/express
 *
 * @example
 * ```ts
 * import express from 'express';
 * import { VeloceTS } from 'veloce-ts';
 * import { ExpressAdapter } from 'veloce-ts/adapters/express';
 *
 * const veloce = new VeloceTS({ docs: true });
 * veloce.get('/hello', { handler: () => ({ message: 'Hello from Veloce!' }) });
 * await veloce.compile();
 *
 * const adapter = new ExpressAdapter(veloce);
 *
 * // Mount Veloce-TS under a sub-path (or mount at root with '/')
 * const expressApp = express();
 * expressApp.use('/api', adapter.getHandler());
 * expressApp.listen(3000);
 * ```
 */
import type { Adapter, ServerInstance } from './base';
import type { VeloceTS } from '../core/application';

/**
 * Minimal structural shape of an Express application — just what this
 * adapter calls. Avoids a hard compile-time dependency on `@types/express`,
 * which (like `express` itself) is an optional peer dependency.
 */
export interface ExpressApp {
  use(handler: (req: any, res: any, next: (err?: unknown) => void) => void): void;
  listen(port: number, callback?: () => void): { close(callback?: () => void): void };
}

/**
 * ExpressAdapter — bridges Veloce-TS to Express.js.
 *
 * The adapter is completely **standalone** (no `require` at module load time).
 * Express is loaded lazily the first time the adapter is constructed, so
 * apps that do not use it pay no startup cost.
 */
export class ExpressAdapter implements Adapter {
  name = 'express';
  private expressApp: ExpressApp;

  /**
   * @param veloceApp - A compiled (or not-yet-compiled) VeloceTS instance.
   * @param expressInstance - Optional pre-created Express application.
   *   Pass your own `express()` if you need to add middleware before the
   *   Veloce-TS bridge is attached.
   */
  constructor(private veloceApp: VeloceTS, expressInstance?: ExpressApp) {
    this.expressApp = expressInstance ?? ExpressAdapter.createExpressApp();
    this.setupBridge();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Start listening on `port`.
   * @returns A ServerInstance wrapping the underlying `http.Server`.
   */
  listen(port: number, callback?: () => void): ServerInstance {
    const server = this.expressApp.listen(port, callback);
    return {
      port,
      close: () => new Promise<void>(resolve => server.close(() => resolve())),
    };
  }

  /**
   * Return the Express application so you can attach additional middleware
   * or mount it with `app.use('/prefix', adapter.getHandler())`.
   */
  getHandler(): ExpressApp {
    return this.expressApp;
  }

  /** Alias for `getHandler()`. */
  getExpressApp(): ExpressApp {
    return this.expressApp;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Lazily load Express (works in ESM and CJS, Bun and Node).
   * Express is a peer dependency so we load it at runtime.
   */
  private static createExpressApp(): ExpressApp {
    // Use Function constructor to escape TypeScript's module-aware narrowing of
    // `require`.  This also ensures the bundler does not try to inline express.
    // eslint-disable-next-line no-new-func
    const _require = (typeof require !== 'undefined'
      ? require
      : Function('return require')()) as (id: string) => any;

    let expressFactory: (...args: any[]) => any;
    try {
      expressFactory = _require('express') as (...args: any[]) => any;
    } catch {
      throw new Error(
        '[ExpressAdapter] Could not load the "express" package.\n' +
        'Install it as a peer dependency:  npm install express'
      );
    }

    return expressFactory();
  }

  /**
   * Register a catch-all Express middleware that forwards every request to
   * Hono and writes the result back.
   */
  private setupBridge(): void {
    const honoApp = this.veloceApp.getHono();

    this.expressApp.use(async (req: any, res: any, next: any) => {
      try {
        const webRequest = this.toWebRequest(req);
        const webResponse = await honoApp.fetch(webRequest);
        await this.writeExpressResponse(res, webResponse);
      } catch (err) {
        // Let Express handle unexpected errors through its error middleware
        next(err);
      }
    });
  }

  /**
   * Convert an Express `req` to a Web-standard `Request`.
   *
   * Body handling:
   * - If Express's `body-parser` (or similar) already parsed the body, it is
   *   re-serialised as JSON.
   * - If the body was streamed directly (raw middleware), the raw buffer is
   *   forwarded as-is.
   */
  private toWebRequest(req: any): Request {
    const protocol = req.protocol ?? 'http';
    const host     = req.get?.('host') ?? req.headers?.host ?? 'localhost';
    const url      = `${protocol}://${host}${req.originalUrl ?? req.url}`;

    const headers = new Headers();
    for (const [key, value] of Object.entries<any>(req.headers ?? {})) {
      if (typeof value === 'string') {
        headers.set(key, value);
      } else if (Array.isArray(value)) {
        value.forEach((v: string) => headers.append(key, v));
      }
    }

    const init: RequestInit = { method: req.method, headers };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (Buffer.isBuffer(req.body)) {
        // Raw body from express.raw() or multer
        init.body = req.body;
      } else if (req.body !== undefined && req.body !== null) {
        // Parsed body from express.json() / express.urlencoded()
        init.body = JSON.stringify(req.body);
        if (!headers.has('content-type')) {
          headers.set('content-type', 'application/json');
        }
      }
    }

    return new Request(url, init);
  }

  /**
   * Write a Web-standard `Response` back through Express `res`.
   *
   * Streams the body chunk-by-chunk instead of buffering it whole (via
   * `.json()`/`.text()`/`.arrayBuffer()`). Buffering defeated SSE (`@SSE`)
   * and `@Stream` responses — the client would wait for the generator to
   * finish before receiving anything — and forced an avoidable
   * serialize/reserialize round-trip on every JSON response. `res.write()`
   * is backpressure-aware: it returns `false` when the socket buffer is
   * full, so we wait for `drain` before writing the next chunk.
   */
  private async writeExpressResponse(res: any, response: Response): Promise<void> {
    res.status(response.status);

    // Forward all headers from Hono to Express
    response.headers.forEach((value: string, key: string) => {
      // Skip hop-by-hop headers that Express manages itself
      if (key.toLowerCase() !== 'transfer-encoding') {
        res.setHeader(key, value);
      }
    });

    if (!response.body) {
      res.end();
      return;
    }

    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          const canContinue = res.write(Buffer.from(value));
          if (!canContinue) {
            await new Promise<void>(resolve => res.once('drain', resolve));
          }
        }
      }
    } finally {
      res.end();
      reader.releaseLock();
    }
  }
}
