/**
 * Global middleware placement (`app.use` with a path and a phase) and per-route
 * body limits.
 */
import { describe, it, expect } from 'bun:test';
import 'reflect-metadata';
import { VeloceTS } from '../src/core/application';
import { Controller, Post, BodyLimit } from '../src/decorators/http';
import { AuthPlugin } from '../src/auth/auth-plugin';
import { InMemoryUserProvider } from '../src/auth/auth-service';

const SECRET = 'test-secret-key-32chars-minimum!!';

async function authedApp(setup: (app: VeloceTS) => void, config: ConstructorParameters<typeof VeloceTS>[0] = {}) {
  const userProvider = new InMemoryUserProvider();
  await userProvider.createUser({ username: 'alice', password: 'secret1', roles: ['user'] });
  const auth = new AuthPlugin({ jwt: { secret: SECRET }, userProvider, enableDefaultRoutes: false });
  const app = new VeloceTS({ docs: false, ...config });
  app.usePlugin(auth);
  setup(app);
  await app.compile();
  const { tokens } = await auth.getAuthService().login('alice', 'secret1');
  return { app, token: tokens.accessToken };
}

describe('app.use phases', () => {
  it("an 'afterPlugins' middleware sees the authenticated user; an 'early' one does not", async () => {
    const seen: Record<string, string | undefined> = {};

    const { app, token } = await authedApp((app) => {
      app.use(async (c, next) => {
        seen.early = c.get('auth.user')?.sub;
        await next();
      });
      app.use(
        async (c, next) => {
          seen.late = c.get('auth.user')?.sub;
          await next();
        },
        { phase: 'afterPlugins' }
      );
      app.get('/x', { handler: () => ({ ok: true }) });
    });

    const res = await app.getHono().request('/x', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    expect(seen.early).toBeUndefined();
    expect(typeof seen.late).toBe('string');
  });

  it("an 'afterPlugins' middleware can short-circuit before the handler", async () => {
    let handled = 0;
    const { app } = await authedApp((app) => {
      app.use(
        async (c, next) => {
          if (!c.get('auth.user')) return c.json({ error: 'members only' }, 401);
          await next();
        },
        { phase: 'afterPlugins' }
      );
      app.get('/x', { handler: () => { handled++; return { ok: true }; } });
    });

    const res = await app.getHono().request('/x');
    expect(res.status).toBe(401);
    expect(handled).toBe(0);
  });

  it('keeps registration order within the afterPlugins phase', async () => {
    const order: string[] = [];
    const { app } = await authedApp((app) => {
      app.use(async (_c, next) => { order.push('late-1'); await next(); }, { phase: 'afterPlugins' });
      app.use(async (_c, next) => { order.push('early'); await next(); });
      app.use(async (_c, next) => { order.push('late-2'); await next(); }, { phase: 'afterPlugins' });
      app.get('/x', { handler: () => ({ ok: true }) });
    });
    await app.getHono().request('/x');
    expect(order).toEqual(['early', 'late-1', 'late-2']);
  });

  it('after compile(), a late registration is attached immediately instead of being lost', async () => {
    const { app } = await authedApp(() => {});
    let ran = false;
    app.use(async (_c, next) => { ran = true; await next(); }, { phase: 'afterPlugins' });
    await app.getHono().request('/anything');
    expect(ran).toBe(true);
  });
});

describe('app.use with a path', () => {
  it('runs only under that path, in either phase', async () => {
    const hits: string[] = [];
    const { app } = await authedApp((app) => {
      app.use('/admin/*', async (c, next) => { hits.push(`early:${c.req.path}`); await next(); });
      app.use('/admin/*', async (c, next) => { hits.push(`late:${c.req.path}`); await next(); }, { phase: 'afterPlugins' });
      app.get('/admin/users', { handler: () => ({ ok: true }) });
      app.get('/public', { handler: () => ({ ok: true }) });
    });

    await app.getHono().request('/public');
    expect(hits).toEqual([]);

    await app.getHono().request('/admin/users');
    expect(hits).toEqual(['early:/admin/users', 'late:/admin/users']);
  });

  it('rejects a non-function middleware with a clear error', () => {
    const app = new VeloceTS({ docs: false });
    expect(() => (app as any).use('/x')).toThrow(TypeError);
  });
});

describe('per-route body limit', () => {
  const body = (bytes: number) => JSON.stringify({ data: 'x'.repeat(bytes) });
  const post = (app: VeloceTS, path: string, payload: string) =>
    app.getHono().request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': String(payload.length) },
      body: payload,
    });

  @Controller('/bl')
  class C {
    @Post('/big')
    @BodyLimit(4096)
    big() { return { ok: true }; }

    @Post('/default')
    normal() { return { ok: true }; }

    @Post('/tiny')
    @BodyLimit(16)
    tiny() { return { ok: true }; }

    @Post('/item/{id}')
    @BodyLimit(4096)
    withParam() { return { ok: true }; }
  }

  it('raises the limit for one route without touching the others', async () => {
    const app = new VeloceTS({ docs: false, bodyLimit: 256 });
    app.include(C);
    await app.compile();

    const payload = body(1024); // above the global 256, below the route's 4096
    expect((await post(app, '/bl/big', payload)).status).toBe(200);
    expect((await post(app, '/bl/default', payload)).status).toBe(413);
  });

  it('can also tighten the limit below the global one', async () => {
    const app = new VeloceTS({ docs: false, bodyLimit: 4096 });
    app.include(C);
    await app.compile();

    expect((await post(app, '/bl/tiny', body(64))).status).toBe(413);
    expect((await post(app, '/bl/default', body(64))).status).toBe(200);
  });

  it('applies on routes with path parameters', async () => {
    const app = new VeloceTS({ docs: false, bodyLimit: 256 });
    app.include(C);
    await app.compile();
    expect((await post(app, '/bl/item/42', body(1024))).status).toBe(200);
  });

  it('enforces a route limit even when the global limit is disabled', async () => {
    const app = new VeloceTS({ docs: false, bodyLimit: 0 });
    app.include(C);
    await app.compile();

    expect((await post(app, '/bl/tiny', body(64))).status).toBe(413);
    expect((await post(app, '/bl/default', body(8192))).status).toBe(200);
  });

  it('works in the functional API', async () => {
    const app = new VeloceTS({ docs: false, bodyLimit: 256 });
    app.post('/fn/big', { handler: () => ({ ok: true }), bodyLimit: 4096 });
    app.post('/fn/default', { handler: () => ({ ok: true }) });
    await app.compile();

    const payload = body(1024);
    expect((await post(app, '/fn/big', payload)).status).toBe(200);
    expect((await post(app, '/fn/default', payload)).status).toBe(413);
  });

  it('rejects a negative size at decoration time', () => {
    expect(() => BodyLimit(-1)).toThrow(RangeError);
  });
});
