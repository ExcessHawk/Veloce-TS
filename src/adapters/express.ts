/**
 * @module veloce-ts/adapters/express
 * @description {@link ExpressAdapter}: monta la app Hono interna detrás de Express reenviando cada request a `fetch` y copiando la `Response`.
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
import type { Adapter } from './base';
import type { VeloceTS } from '../core/application';

/**
 * ExpressAdapter — bridges Veloce-TS to Express.js.
 *
 * The adapter is completely **standalone** (no `require` at module load time).
 * Express is loaded lazily the first time the adapter is constructed, so
 * apps that do not use it pay no startup cost.
 */
export class ExpressAdapter implements Adapter {
  name = 'express';
  private expressApp: any;

  /**
   * @param veloceApp - A compiled (or not-yet-compiled) VeloceTS instance.
   * @param expressInstance - Optional pre-created Express application.
   *   Pass your own `express()` if you need to add middleware before the
   *   Veloce-TS bridge is attached.
   */
  constructor(private veloceApp: VeloceTS, expressInstance?: any) {
    this.expressApp = expressInstance ?? ExpressAdapter.createExpressApp();
    this.setupBridge();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Start listening on `port`.
   * @returns The underlying `http.Server` instance.
   */
  listen(port: number, callback?: () => void): any {
    return this.expressApp.listen(port, callback);
  }

  /**
   * Return the Express application so you can attach additional middleware
   * or mount it with `app.use('/prefix', adapter.getHandler())`.
   */
  getHandler(): any {
    return this.expressApp;
  }

  /** Alias for `getHandler()`. */
  getExpressApp(): any {
    return this.expressApp;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Lazily load Express (works in ESM and CJS, Bun and Node).
   * Express is a peer dependency so we load it at runtime.
   */
  private static createExpressApp(): any {
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

    const contentType = response.headers.get('content-type') ?? '';

    if (contentType.includes('application/json')) {
      const json = await response.json();
      res.json(json);
    } else if (contentType.startsWith('text/')) {
      const text = await response.text();
      res.send(text);
    } else {
      // Binary / streaming content — send as Buffer
      const buffer = await response.arrayBuffer();
      res.send(Buffer.from(buffer));
    }
  }
}
