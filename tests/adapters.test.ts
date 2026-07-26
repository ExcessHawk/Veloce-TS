/**
 * Adapter tests — previously untested (`src/adapters/` had zero coverage).
 *
 * ExpressAdapter is exercised with a fake Express-like object implementing
 * just the structural `ExpressApp` surface (`use`/`listen`) plus fake
 * `req`/`res` objects — no real `express` package needed, since it's an
 * optional peer dependency not installed in this repo.
 */
import { describe, it, expect } from 'bun:test';
import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import { VeloceTS } from '../src/core/application';
import { ExpressAdapter, type ExpressApp } from '../src/adapters/express';
import { HonoAdapter } from '../src/adapters/hono';
import { Controller, Get } from '../src/decorators/http';
import { SSE } from '../src/decorators/stream';

/** Minimal fake Express `res` — a writable-like object tests can inspect. */
function makeFakeRes() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    statusCode: 0,
    headers: {} as Record<string, string>,
    writes: [] as Buffer[],
    ended: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(key: string, value: string) {
      this.headers[key.toLowerCase()] = value;
    },
    write(chunk: Buffer) {
      this.writes.push(chunk);
      return true; // no backpressure in the fake
    },
    end() {
      this.ended = true;
    },
  });
}

/** Fake Express app capturing the single bridge middleware ExpressAdapter registers. */
function makeFakeExpressApp(): ExpressApp & { middleware?: (req: any, res: any, next: any) => void } {
  const app: any = {
    middleware: undefined,
    use(handler: any) {
      app.middleware = handler;
    },
    listen(port: number, callback?: () => void) {
      callback?.();
      return { close: (cb?: () => void) => cb?.() };
    },
  };
  return app;
}

describe('ExpressAdapter', () => {
  it('bridges a GET request through Hono fetch and copies status/headers/JSON body', async () => {
    @Controller('/items')
    class ItemController {
      @Get('/:id')
      get() {
        return { id: '42', name: 'widget' };
      }
    }

    const veloce = new VeloceTS({ docs: false, cors: false });
    veloce.include(ItemController);
    await veloce.compile();

    const fakeExpressApp = makeFakeExpressApp();
    new ExpressAdapter(veloce, fakeExpressApp);

    const res = makeFakeRes();
    const req = {
      method: 'GET',
      url: '/items/42',
      originalUrl: '/items/42',
      protocol: 'http',
      headers: { host: 'localhost' },
      get(name: string) { return this.headers[name.toLowerCase()]; },
    };

    await fakeExpressApp.middleware!(req, res, () => {});

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.ended).toBe(true);
    const body = JSON.parse(Buffer.concat(res.writes).toString('utf-8'));
    expect(body).toEqual({ id: '42', name: 'widget' });
  });

  it('streams an SSE response incrementally instead of buffering the whole body (P4-6)', async () => {
    @Controller('/events')
    class EventsController {
      @Get('/')
      @SSE()
      async *stream() {
        yield { data: 'first' };
        yield { data: 'second' };
        yield { data: 'third' };
      }
    }

    const veloce = new VeloceTS({ docs: false, cors: false });
    veloce.include(EventsController);
    await veloce.compile();

    const fakeExpressApp = makeFakeExpressApp();
    new ExpressAdapter(veloce, fakeExpressApp);

    const res = makeFakeRes();
    const req = {
      method: 'GET',
      url: '/events',
      originalUrl: '/events',
      protocol: 'http',
      headers: { host: 'localhost' },
      get(name: string) { return this.headers[name.toLowerCase()]; },
    };

    await fakeExpressApp.middleware!(req, res, () => {});

    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.ended).toBe(true);
    // More than one write proves the body was streamed chunk-by-chunk
    // rather than fully buffered via a single arrayBuffer()/text() call.
    expect(res.writes.length).toBeGreaterThan(1);
    const full = Buffer.concat(res.writes).toString('utf-8');
    expect(full).toContain('first');
    expect(full).toContain('second');
    expect(full).toContain('third');
  });

  it('respects backpressure: waits for a "drain" event when write() returns false', async () => {
    @Controller('/big')
    class BigController {
      @Get('/')
      @SSE()
      async *stream() {
        yield { chunk: 1 };
        yield { chunk: 2 };
      }
    }

    const veloce = new VeloceTS({ docs: false, cors: false });
    veloce.include(BigController);
    await veloce.compile();

    const fakeExpressApp = makeFakeExpressApp();
    new ExpressAdapter(veloce, fakeExpressApp);

    const res = makeFakeRes();
    let firstWriteReturnedFalse = false;
    const originalWrite = res.write.bind(res);
    res.write = (chunk: Buffer) => {
      originalWrite(chunk);
      if (!firstWriteReturnedFalse) {
        firstWriteReturnedFalse = true;
        // Simulate a full socket buffer on the first chunk only
        queueMicrotask(() => res.emit('drain'));
        return false;
      }
      return true;
    };

    const req = {
      method: 'GET',
      url: '/big',
      originalUrl: '/big',
      protocol: 'http',
      headers: { host: 'localhost' },
      get(name: string) { return this.headers[name.toLowerCase()]; },
    };

    // Must resolve (not hang) once 'drain' fires
    await fakeExpressApp.middleware!(req, res, () => {});
    expect(res.ended).toBe(true);
    expect(firstWriteReturnedFalse).toBe(true);
  });

  it('listen() delegates to the Express app and returns a ServerInstance with close()', async () => {
    const veloce = new VeloceTS({ docs: false, cors: false });
    await veloce.compile();

    const fakeExpressApp = makeFakeExpressApp();
    const adapter = new ExpressAdapter(veloce, fakeExpressApp);

    let listenCallbackCalled = false;
    const server = adapter.listen(0, () => { listenCallbackCalled = true; });

    expect(listenCallbackCalled).toBe(true);
    expect(server.port).toBe(0);
    await expect(server.close()).resolves.toBeUndefined();
  });

  it('getHandler()/getExpressApp() return the underlying Express app', async () => {
    const veloce = new VeloceTS({ docs: false, cors: false });
    await veloce.compile();

    const fakeExpressApp = makeFakeExpressApp();
    const adapter = new ExpressAdapter(veloce, fakeExpressApp);

    expect(adapter.getHandler()).toBe(fakeExpressApp);
    expect(adapter.getExpressApp()).toBe(fakeExpressApp);
  });
});

describe('HonoAdapter.getHandler()', () => {
  it('returns a fetch function bound to the Hono instance (works when detached)', async () => {
    @Controller('/ping')
    class PingController {
      @Get('/')
      ping() {
        return { pong: true };
      }
    }

    const veloce = new VeloceTS({ docs: false, cors: false });
    veloce.include(PingController);
    await veloce.compile();

    const adapter = new HonoAdapter(veloce.getHono());
    const handler = adapter.getHandler();

    // Call detached from `adapter` — proves .bind(this.hono) actually took effect
    const detached = handler;
    const res = await detached(new Request('http://localhost/ping'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ pong: true });
  });
});

describe('VeloceTS.getFetchHandler() (Cloudflare Workers deploy path)', () => {
  it('auto-compiles and returns a working fetch handler', async () => {
    const app = new VeloceTS({ docs: false, cors: false });
    app.get('/health', { handler: () => ({ ok: true }) });

    // Not compiled yet — getFetchHandler() must compile it, same as listen()
    expect(app.isCompiled()).toBe(false);
    const fetchHandler = await app.getFetchHandler();
    expect(app.isCompiled()).toBe(true);

    const res = await fetchHandler(new Request('http://localhost/health'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('is idempotent when the app is already compiled', async () => {
    const app = new VeloceTS({ docs: false, cors: false });
    app.get('/ok', { handler: () => ({ ok: true }) });
    await app.compile();

    const fetchHandler = await app.getFetchHandler();
    const res = await fetchHandler(new Request('http://localhost/ok'));
    expect(res.status).toBe(200);
  });
});
