/**
 * Core framework tests — VeloceTS routing, middleware, error handling
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { VeloceTS } from '../src/core/application';
import { z } from 'zod';

// ─── Helper ───────────────────────────────────────────────────────────────────

async function request(
  app: VeloceTS,
  method: string,
  path: string,
  body?: any,
  headers?: Record<string, string>
): Promise<Response> {
  if (!app.isCompiled()) await app.compile();
  const hono = app.getHono();
  return hono.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
    })
  );
}

// ─── Routing ──────────────────────────────────────────────────────────────────

describe('Functional routing', () => {
  let app: VeloceTS;

  beforeEach(() => { app = new VeloceTS(); });

  it('GET route returns 200 with JSON', async () => {
    app.get('/hello', { handler: async () => ({ message: 'hello' }) });
    const res = await request(app, 'GET', '/hello');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.message).toBe('hello');
  });

  it('POST route receives body', async () => {
    const schema = z.object({ name: z.string() });
    app.post('/echo', {
      handler: async (c) => {
        const body = await c.req.json();
        return { name: body.name };
      },
      schema: { body: schema }
    });
    const res = await request(app, 'POST', '/echo', { name: 'Alfredo' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.name).toBe('Alfredo');
  });

  it('Unknown route returns 404', async () => {
    const res = await request(app, 'GET', '/nonexistent');
    expect(res.status).toBe(404);
  });

  it('Route with path param returns param value', async () => {
    app.get('/users/:id', {
      handler: async (c) => ({ id: c.req.param('id') })
    });
    const res = await request(app, 'GET', '/users/42');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe('42');
  });

  it('Route group applies prefix', async () => {
    app.group('/api/v1', () => {
      app.get('/ping', { handler: async () => ({ ok: true }) });
    });
    const res = await request(app, 'GET', '/api/v1/ping');
    expect(res.status).toBe(200);
  });

  it('compile() is idempotent — calling twice does not crash', async () => {
    app.get('/idempotent', { handler: async () => ({ ok: true }) });
    await app.compile();
    await app.compile(); // second call should be a no-op
    expect(app.isCompiled()).toBe(true);
  });

  it('null handler result returns 204', async () => {
    app.get('/nothing', { handler: async () => null });
    const res = await request(app, 'GET', '/nothing');
    expect(res.status).toBe(204);
  });
});

// ─── Middleware ────────────────────────────────────────────────────────────────

describe('Global middleware', () => {
  it('middleware runs before handler', async () => {
    const app = new VeloceTS();
    app.use(async (c, next) => {
      c.set('mw', 'ran');
      await next();
    });
    app.get('/mw', {
      handler: async (c) => ({ mw: (c as any).get('mw') })
    });
    const res = await request(app, 'GET', '/mw');
    const json = await res.json();
    expect(json.mw).toBe('ran');
  });

  it('middleware returning early short-circuits handler', async () => {
    const app = new VeloceTS();
    app.use(async (c, _next) => {
      return c.json({ blocked: true }, 403);
    });
    app.get('/secret', { handler: async () => ({ data: 'secret' }) });
    const res = await request(app, 'GET', '/secret');
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.blocked).toBe(true);
  });
});

// ─── Error handling ────────────────────────────────────────────────────────────

describe('Error handling', () => {
  it('thrown error returns 500', async () => {
    const app = new VeloceTS();
    app.get('/boom', {
      handler: async () => { throw new Error('something went wrong'); }
    });
    const res = await request(app, 'GET', '/boom');
    expect(res.status).toBe(500);
  });

  it('custom error handler is called', async () => {
    const app = new VeloceTS();
    app.onError(async (err, c) => {
      return c.json({ custom: true, msg: err.message }, 418);
    });
    app.get('/teapot', {
      handler: async () => { throw new Error('teapot!'); }
    });
    const res = await request(app, 'GET', '/teapot');
    expect(res.status).toBe(418);
    const json = await res.json();
    expect(json.custom).toBe(true);
  });
});

// ─── CORS ─────────────────────────────────────────────────────────────────────

describe('CORS middleware', () => {
  it('preflight from allowed origin returns 204', async () => {
    const app = new VeloceTS({ cors: { origin: 'https://mysite.com' } });
    app.get('/data', { handler: async () => ({ ok: true }) });
    const res = await request(app, 'OPTIONS', '/data', undefined, {
      Origin: 'https://mysite.com',
      'Access-Control-Request-Method': 'GET'
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://mysite.com');
  });

  it('preflight from disallowed origin returns 403', async () => {
    const app = new VeloceTS({ cors: { origin: ['https://mysite.com'] } });
    app.get('/data', { handler: async () => ({ ok: true }) });
    const res = await request(app, 'OPTIONS', '/data', undefined, {
      Origin: 'https://evil.com',
      'Access-Control-Request-Method': 'GET'
    });
    expect(res.status).toBe(403);
  });
});
