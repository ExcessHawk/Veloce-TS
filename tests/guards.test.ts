/**
 * Regression tests for the 2026-09-04 review (REVIEW-2026-09-04.md).
 *
 * Every case here reproduces a defect that shipped in v2.0.2 and was confirmed
 * against the real HTTP surface. They assert the *correct* behaviour, so a
 * failure means the corresponding fix has regressed.
 */
import { describe, it, expect } from 'bun:test';
import { z } from 'zod';
import { VeloceTS } from '../src/core/application';
import { Controller, Get, Post, HttpCode, ResponseSchema } from '../src/decorators/http';
import { Body } from '../src/decorators/params';
import { Cache } from '../src/decorators/cache';
import { Auth, CurrentUser } from '../src/auth/decorators';
import { AuthPlugin } from '../src/auth/auth-plugin';
import { AuthService, InMemoryUserProvider } from '../src/auth/auth-service';
import { InvalidTokenException } from '../src/auth/exceptions';
import { SessionPlugin } from '../src/auth/session-plugin';
import { Session, RequireCSRF } from '../src/auth/session-decorators';
import { UseInterceptor, type Interceptor, type ExecutionContext } from '../src/core/interceptor-manager';
import { Catch, type ExceptionFilter } from '../src/errors/exception-filter';
import { ValidationException } from '../src/validation/exceptions';
import { DIContainer } from '../src/dependencies/container';
import { CacheManager } from '../src/cache/manager';
import { JWTProvider } from '../src/auth/jwt-provider';
import type { Context } from 'hono';

const SECRET = 'test-secret-key-32chars-minimum!!';

async function authApp(controller: any, opts: { roles?: string[] } = {}) {
  const userProvider = new InMemoryUserProvider();
  await userProvider.createUser({
    username: 'alice',
    password: 'secret1',
    roles: opts.roles ?? ['user'],
  });
  const plugin = new AuthPlugin({
    jwt: { secret: SECRET },
    userProvider,
    enableDefaultRoutes: false,
  });
  const app = new VeloceTS({ docs: false });
  app.usePlugin(plugin);
  app.include(controller);
  await app.compile();
  const { tokens } = await plugin.getAuthService().login('alice', 'secret1');
  return { app, token: tokens.accessToken };
}

// ─── R-1: route guards actually run ──────────────────────────────────────────

describe('R-1 @Auth() is enforced', () => {
  it('rejects an anonymous request even without @CurrentUser()', async () => {
    @Controller('/r1a')
    class C {
      @Get('/secret')
      @Auth()
      secret() { return { ok: true }; }
    }
    const { app } = await authApp(C);
    const res = await app.getHono().request('/r1a/secret');
    expect(res.status).toBe(401);
  });

  it('allows an authenticated request', async () => {
    @Controller('/r1b')
    class C {
      @Get('/secret')
      @Auth()
      secret() { return { ok: true }; }
    }
    const { app, token } = await authApp(C);
    const res = await app.getHono().request('/r1b/secret', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  it('returns 403 when the user lacks a required role', async () => {
    @Controller('/r1c')
    class C {
      @Get('/admin')
      @Auth({ roles: ['admin'] })
      admin(@CurrentUser() user: any) { return { user: user?.sub }; }
    }
    const { app, token } = await authApp(C);
    const res = await app.getHono().request('/r1c/admin', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });

  it('allows a user that has the required role', async () => {
    @Controller('/r1d')
    class C {
      @Get('/admin')
      @Auth({ roles: ['admin'] })
      admin() { return { ok: true }; }
    }
    const { app, token } = await authApp(C, { roles: ['admin'] });
    const res = await app.getHono().request('/r1d/admin', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });
});

describe('R-1 session guards are enforced', () => {
  function sessionApp(controller: any) {
    const app = new VeloceTS({ docs: false });
    app.usePlugin(new SessionPlugin({
      session: { secret: SECRET },
      enableManagementRoutes: false,
    }));
    app.include(controller);
    return app;
  }

  it('@Session({ required: true }) returns 401 without a session cookie', async () => {
    @Controller('/r1e')
    class C {
      @Get('/me')
      @Session({ required: true })
      me() { return { ok: true }; }
    }
    const app = sessionApp(C);
    await app.compile();
    const res = await app.getHono().request('/r1e/me');
    expect(res.status).toBe(401);
  });

  it('@RequireCSRF() rejects a POST with no CSRF token', async () => {
    @Controller('/r1f')
    class C {
      @Post('/act')
      @RequireCSRF()
      act() { return { ok: true }; }
    }
    const app = sessionApp(C);
    await app.compile();
    const res = await app.getHono().request('/r1f/act', { method: 'POST' });
    expect(res.status).toBe(403);
  });
});

// ─── R-8: class-level interceptors ───────────────────────────────────────────

describe('R-8 class-level @UseInterceptor', () => {
  it('runs for every route of the controller', async () => {
    let hits = 0;
    const marker: Interceptor = {
      async intercept(_ctx: ExecutionContext, next) { hits++; return next(); },
    };
    @Controller('/r8')
    @UseInterceptor(marker)
    class C {
      @Get('/x') x() { return { ok: true }; }
      @Get('/y') y() { return { ok: true }; }
    }
    const app = new VeloceTS({ docs: false });
    app.include(C);
    await app.compile();
    await app.getHono().request('/r8/x');
    await app.getHono().request('/r8/y');
    expect(hits).toBe(2);
  });
});

// ─── R-9: filters see validation errors ──────────────────────────────────────

describe('R-9 exception filters', () => {
  it('@Catch(ValidationException) is invoked for an invalid body', async () => {
    let caught = false;
    @Catch(ValidationException)
    class VF implements ExceptionFilter {
      catch(_e: Error, c: Context) { caught = true; return c.json({ custom: true }, 400); }
    }
    @Controller('/r9')
    class C {
      @Post('/x') x(@Body(z.object({ n: z.number() })) body: any) { return body; }
    }
    const app = new VeloceTS({ docs: false });
    app.useFilter(new VF());
    app.include(C);
    await app.compile();
    const res = await app.getHono().request('/r9/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ n: 'not-a-number' }),
    });
    expect(caught).toBe(true);
    expect(res.status).toBe(400);
  });
});

// ─── R-2: cached responses honour @ResponseSchema / @HttpCode ────────────────

describe('R-2 cache HIT replays the validated response', () => {
  it('strips schema-excluded fields and keeps the status code', async () => {
    CacheManager.reset();
    @Controller('/r2')
    class C {
      @Get('/x')
      @HttpCode(201)
      @ResponseSchema(z.object({ id: z.string() }))
      @Cache({ ttl: 60 })
      x() { return { id: '1', password: 'hunter2' }; }
    }
    const app = new VeloceTS({ docs: false });
    app.include(C);
    await app.compile();

    const r1 = await app.getHono().request('/r2/x');
    const b1 = await r1.json();
    const r2 = await app.getHono().request('/r2/x');
    const b2 = await r2.json();

    expect(r1.headers.get('x-cache')).toBe('MISS');
    expect(r2.headers.get('x-cache')).toBe('HIT');
    expect(b1).toEqual({ id: '1' });
    expect(b2).toEqual({ id: '1' });
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    CacheManager.reset();
  });
});

// ─── R-3: cache key can vary by caller ───────────────────────────────────────

describe('R-3 per-caller cache isolation', () => {
  it('varyByHeaders keeps two callers on separate cache entries', async () => {
    CacheManager.reset();
    let calls = 0;
    @Controller('/r3')
    class C {
      @Get('/me')
      @Cache({ ttl: 60, varyByHeaders: ['authorization'] })
      me() { return { call: ++calls }; }
    }
    const app = new VeloceTS({ docs: false });
    app.include(C);
    await app.compile();

    const a1 = await (await app.getHono().request('/r3/me', { headers: { authorization: 'Bearer a' } })).json();
    const b1 = await (await app.getHono().request('/r3/me', { headers: { authorization: 'Bearer b' } })).json();
    const a2 = await app.getHono().request('/r3/me', { headers: { authorization: 'Bearer a' } });

    expect(a1).not.toEqual(b1);            // different callers → different entries
    expect(a2.headers.get('x-cache')).toBe('HIT'); // same caller → cached
    CacheManager.reset();
  });
});

// ─── R-10: DI under concurrency ──────────────────────────────────────────────

describe('R-10 DIContainer concurrency', () => {
  it('concurrent resolves of the same async provider do not report a false cycle', async () => {
    const c = new DIContainer();
    const TOKEN = 'svc';
    c.register(TOKEN, {
      scope: 'transient',
      factory: async () => { await new Promise(r => setTimeout(r, 5)); return {}; },
    });
    await expect(Promise.all([c.resolve(TOKEN), c.resolve(TOKEN)])).resolves.toHaveLength(2);
  });

  it('concurrent singleton resolves create exactly one instance', async () => {
    const c = new DIContainer();
    let created = 0;
    const TOKEN = 'single';
    c.register(TOKEN, {
      scope: 'singleton',
      factory: async () => { created++; await new Promise(r => setTimeout(r, 5)); return {}; },
    });
    const [a, b] = await Promise.all([c.resolve(TOKEN), c.resolve(TOKEN)]);
    expect(created).toBe(1);
    expect(a).toBe(b);
  });

  it('still detects a genuine cycle from inside a factory', async () => {
    const c = new DIContainer();
    const TOKEN = 'self';
    c.register(TOKEN, { scope: 'transient', factory: async () => c.resolve(TOKEN) });
    await expect(c.resolve(TOKEN)).rejects.toThrow('Circular dependency detected');
  });
});

// ─── R-11: same-named controllers ────────────────────────────────────────────

describe('R-11 controllers with the same class name', () => {
  it('both keep their routes', async () => {
    const A = (() => { @Controller('/r11-a') class UserController { @Get('/') list() { return { from: 'a' }; } } return UserController; })();
    const B = (() => { @Controller('/r11-b') class UserController { @Get('/') list() { return { from: 'b' }; } } return UserController; })();

    const app = new VeloceTS({ docs: false });
    app.include(A);
    app.include(B);
    await app.compile();

    const ra = await app.getHono().request('/r11-a');
    const rb = await app.getHono().request('/r11-b');
    expect(ra.status).toBe(200);
    expect(rb.status).toBe(200);
    expect(await ra.json()).toEqual({ from: 'a' });
    expect(await rb.json()).toEqual({ from: 'b' });
  });
});

// ─── R-12: config options are wired ──────────────────────────────────────────

describe('R-12 VeloceTSConfig docs / plugins', () => {
  it('docs: true serves the OpenAPI spec', async () => {
    const app = new VeloceTS({ docs: true });
    app.get('/x', { handler: () => ({}) });
    await app.compile();
    const res = await app.getHono().request('/openapi.json');
    expect(res.status).toBe(200);
  });

  it('docs: false serves nothing', async () => {
    const app = new VeloceTS({ docs: false });
    app.get('/x', { handler: () => ({}) });
    await app.compile();
    const res = await app.getHono().request('/openapi.json');
    expect(res.status).toBe(404);
  });

  it('plugins: [...] installs the plugin', async () => {
    let installed = false;
    const app = new VeloceTS({ docs: false, plugins: [{ name: 'p', install() { installed = true; } }] });
    await app.compile();
    expect(installed).toBe(true);
  });
});

// ─── R-13: malformed JSON ────────────────────────────────────────────────────

describe('R-13 malformed JSON body', () => {
  it('returns 400 naming the JSON problem', async () => {
    @Controller('/r13')
    class C { @Post('/x') x(@Body(z.object({ n: z.number() })) b: any) { return b; } }
    const app = new VeloceTS({ docs: false });
    app.include(C);
    await app.compile();
    const res = await app.getHono().request('/r13/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain('json');
  });
});

// ─── R-14: refresh error typing ──────────────────────────────────────────────

describe('R-14 AuthService.refresh', () => {
  it('throws InvalidTokenException for a garbage refresh token', async () => {
    const svc = new AuthService({ secret: SECRET }, new InMemoryUserProvider());
    await expect(svc.refresh('garbage')).rejects.toBeInstanceOf(InvalidTokenException);
  });
});

// ─── R-17: refresh rotation is single-use ────────────────────────────────────

describe('R-17 refresh token rotation', () => {
  it('only one of two concurrent refreshes with the same token succeeds', async () => {
    const provider = new JWTProvider({ secret: SECRET });
    const { refreshToken } = provider.generateTokens({ sub: 'u1' });

    const results = await Promise.allSettled([
      provider.refreshAccessToken(refreshToken),
      provider.refreshAccessToken(refreshToken),
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);
  });
});

// ─── R-4: body limit ─────────────────────────────────────────────────────────

describe('R-4 request body limit', () => {
  it('rejects a body over the configured limit with 413', async () => {
    @Controller('/r4')
    class C { @Post('/x') x(@Body() b: any) { return b; } }
    const app = new VeloceTS({ docs: false, bodyLimit: 128 });
    app.include(C);
    await app.compile();

    const res = await app.getHono().request('/r4/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blob: 'x'.repeat(500) }),
    });
    expect(res.status).toBe(413);
  });
});

// ─── R-18: session cookie is signed ──────────────────────────────────────────

describe('R-18 session cookie signing', () => {
  it('rejects a forged session id', async () => {
    const { SessionManager, MemorySessionStore } = await import('../src/auth/session');
    const store = new MemorySessionStore(999_999);
    const manager = new SessionManager(store, { secret: SECRET });

    const session = await manager.createSession('user-1');
    const signed = manager.signSessionId(session.id);

    expect(manager.unsignSessionId(signed)).toBe(session.id);
    expect(manager.unsignSessionId(session.id)).toBeNull();          // unsigned
    expect(manager.unsignSessionId(`${session.id}.deadbeef`)).toBeNull(); // tampered
    store.stopCleanup();
  });

  it('requires a secret', () => {
    const { SessionManager, MemorySessionStore } = require('../src/auth/session');
    expect(() => new SessionManager(new MemorySessionStore(999_999), { secret: '' } as any))
      .toThrow('secret is required');
  });
});

// ─── R-19: CORS ──────────────────────────────────────────────────────────────

describe('R-19 CORS configuration', () => {
  it('sets Vary: Origin when the allowed origin depends on the request', async () => {
    const app = new VeloceTS({ docs: false, cors: { origin: ['https://a.example'] } });
    app.get('/x', { handler: () => ({ ok: true }) });
    await app.compile();
    const res = await app.getHono().request('/x', { headers: { origin: 'https://a.example' } });
    expect(res.headers.get('vary')).toContain('Origin');
  });

  it('refuses wildcard origin combined with credentials', async () => {
    const { createCorsMiddleware } = await import('../src/middleware/cors');
    expect(() => createCorsMiddleware({ origin: '*', credentials: true }))
      .toThrow('credentials: true cannot be combined');
  });
});
