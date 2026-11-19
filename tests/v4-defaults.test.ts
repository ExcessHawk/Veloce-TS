/**
 * v4.0.0: the defaults that flipped, each with the option that restores the
 * previous behavior — plus `deprecate()` and the two decorators that became
 * functional in 3.9.0.
 */
import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import 'reflect-metadata';
import { VeloceTS } from '../src/core/application';
import { Controller, Get } from '../src/decorators/http';
import { ResponseHeader, Redirect } from '../src/decorators/extras';
import { Ctx } from '../src/decorators/params';
import { AuthPlugin } from '../src/auth/auth-plugin';
import { RBACPlugin, type RBACPluginConfig } from '../src/auth/rbac-plugin';
import { Roles } from '../src/auth/rbac-decorators';
import { Public } from '../src/auth/decorators';
import { InMemoryUserProvider } from '../src/auth/auth-service';
import { SessionPlugin } from '../src/auth/session-plugin';
import { GraphQLPlugin } from '../src/graphql/plugin';
import { ErrorHandler } from '../src/errors/handler';
import { deprecate, resetDeprecations } from '../src/logging/deprecation';
import { getLogger } from '../src/logging/logger';
import { setupTestApp } from '../src/testing/helpers';
import * as root from '../src/index';
import type { Context } from 'hono';

const SECRET = 'test-secret-key-32chars-minimum!!';

async function authed(
  setup: (app: VeloceTS) => void,
  opts: { auth?: Record<string, unknown>; rbac?: RBACPluginConfig; roles?: string[] } = {}
) {
  const userProvider = new InMemoryUserProvider();
  await userProvider.createUser({ username: 'alice', password: 'secret1', roles: opts.roles ?? ['member'] });
  const auth = new AuthPlugin({ jwt: { secret: SECRET }, userProvider, enableDefaultRoutes: false, ...opts.auth });
  const app = new VeloceTS({ docs: false });
  app.usePlugin(auth);
  if (opts.rbac) app.usePlugin(new RBACPlugin(opts.rbac));
  setup(app);
  await app.compile();
  const { tokens } = await auth.getAuthService().login('alice', 'secret1');
  const call = (path: string, init: { method?: string; anonymous?: boolean } = {}) =>
    app.getHono().request(path, {
      method: init.method ?? 'GET',
      headers: init.anonymous ? {} : { Authorization: `Bearer ${tokens.accessToken}` },
    });
  return { app, call };
}

describe('deny by default', () => {
  it('a route with no access rule requires a token', async () => {
    const { call } = await authed((app) => {
      app.get('/plain', { handler: () => ({ ok: true }) });
      app.get('/open', { handler: () => ({ ok: true }), public: true });
    });
    expect((await call('/plain', { anonymous: true })).status).toBe(401);
    expect((await call('/plain')).status).toBe(200);
    expect((await call('/open', { anonymous: true })).status).toBe(200);
  });

  it('requireAuthByDefault: false keeps undecorated routes public', async () => {
    const { call } = await authed(
      (app) => app.get('/plain', { handler: () => ({ ok: true }) }),
      { auth: { requireAuthByDefault: false } }
    );
    expect((await call('/plain', { anonymous: true })).status).toBe(200);
  });

  it('without AuthPlugin nothing is guarded', async () => {
    const { client } = await setupTestApp((app) => app.get('/plain', { handler: () => ({ ok: true }) }));
    expect((await client.get('/plain')).status).toBe(200);
  });

  it('session routes stay reachable: they authenticate with the session cookie', async () => {
    const userProvider = new InMemoryUserProvider();
    const app = new VeloceTS({ docs: false });
    app.usePlugin(new AuthPlugin({ jwt: { secret: SECRET }, userProvider, enableDefaultRoutes: false }));
    app.usePlugin(new SessionPlugin({ session: { secret: 'session-secret-at-least-32-chars!!' } }));
    await app.compile();

    // No bearer token. A 401 from the JWT guard would say "Authentication required".
    const res = await app.getHono().request('/session/info');
    const text = await res.text();
    expect(text).not.toContain('Missing or invalid Authorization header');
  });

  it('the GraphQL endpoint is not behind the HTTP guard unless asked', async () => {
    const build = async (isPublic?: boolean) => {
      const userProvider = new InMemoryUserProvider();
      const app = new VeloceTS({ docs: false });
      app.usePlugin(new AuthPlugin({ jwt: { secret: SECRET }, userProvider, enableDefaultRoutes: false }));
      app.usePlugin(new GraphQLPlugin({ playground: false, ...(isPublic === undefined ? {} : { public: isPublic }) }));
      await app.compile();
      return app.getHono().request('/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '{ __typename }' }),
      });
    };
    expect((await build()).status).not.toBe(401);
    expect((await build(false)).status).toBe(401);
  });
});

describe('RBACPlugin defaults', () => {
  const own = [{ name: 'member', permissions: [] }];

  it('does not register the /rbac/* routes unless asked', async () => {
    const off = await authed(() => {}, { rbac: { roles: own } });
    expect((await off.call('/rbac/roles')).status).toBe(404);

    const on = await authed(() => {}, { rbac: { roles: own, enableManagementRoutes: true } });
    expect((await on.call('/rbac/roles')).status).toBe(200);
  });

  it('does not create the built-in roles next to user-defined ones', async () => {
    const mine = new RBACPlugin({ roles: own });
    expect(mine.getRBACManager().getRole('admin')).toBeFalsy();
    expect(mine.getRBACManager().getRole('member')).toBeTruthy();
  });

  it('creates them when the app defines none, or asks for them', async () => {
    expect(new RBACPlugin().getRBACManager().getRole('admin')).toBeTruthy();
    expect(new RBACPlugin({ roles: own, useDefaults: true }).getRBACManager().getRole('admin')).toBeTruthy();
    expect(new RBACPlugin({ useDefaults: false }).getRBACManager().getRole('admin')).toBeFalsy();
  });

  it('@Roles still works with user-defined roles only', async () => {
    @Controller('/v4r')
    class C {
      @Get('/m') @Roles(['member']) m() { return { ok: true }; }
      @Get('/a') @Roles(['admin']) a() { return { ok: true }; }
    }
    const { call } = await authed((app) => app.include(C), { rbac: { roles: own } });
    expect((await call('/v4r/m')).status).toBe(200);
    expect((await call('/v4r/a')).status).toBe(403);
  });
});

describe('error detail', () => {
  const original = process.env.NODE_ENV;
  afterEach(() => { process.env.NODE_ENV = original; });

  const detail = (env: string | undefined) => {
    if (env === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = env;
    return new ErrorHandler().isDevelopmentMode();
  };

  it('is sent only in development and test', () => {
    expect(detail('development')).toBe(true);
    expect(detail('test')).toBe(true);
    expect(detail('production')).toBe(false);
    expect(detail('staging')).toBe(false);
    expect(detail(undefined)).toBe(false);
  });

  it('forceDevelopment still decides either way', () => {
    process.env.NODE_ENV = 'production';
    expect(new ErrorHandler(undefined, { forceDevelopment: true }).isDevelopmentMode()).toBe(true);
    process.env.NODE_ENV = 'development';
    expect(new ErrorHandler(undefined, { forceDevelopment: false }).isDevelopmentMode()).toBe(false);
  });

  it('an unexpected error does not leak its message when NODE_ENV is unset', async () => {
    delete process.env.NODE_ENV;
    const { client } = await setupTestApp((app) => {
      app.get('/boom', { handler: () => { throw new Error('connection string postgres://secret@db'); } });
    });
    const res = await client.get('/boom');
    expect(res.status).toBe(500);
    expect(res.text).not.toContain('postgres://secret');
    expect(res.text).not.toContain('stack');
  });
});

describe('removed in v4.0.0', () => {
  it('@Throttle and @ApiVersion are no longer exported', () => {
    expect('Throttle' in root).toBe(false);
    expect('ApiVersion' in root).toBe(false);
    expect(typeof root.RateLimit).toBe('function');
  });
});

describe('deprecate()', () => {
  let notices: string[] = [];
  let spy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    resetDeprecations();
    notices = [];
    spy = spyOn(getLogger(), 'warn').mockImplementation(((msg: unknown) => {
      if (typeof msg === 'string' && msg.includes('[veloce-ts deprecation')) notices.push(msg);
    }) as any);
  });
  afterEach(() => {
    spy.mockRestore();
    delete process.env.VELOCE_NO_DEPRECATION;
  });

  it('logs a notice once per code', () => {
    deprecate('x', 'first');
    deprecate('x', 'second');
    deprecate('y', 'other');
    expect(notices).toHaveLength(2);
    expect(notices[0]).toContain('[veloce-ts deprecation x] first');
  });

  it('VELOCE_NO_DEPRECATION=1 silences everything; a list silences only those codes', () => {
    process.env.VELOCE_NO_DEPRECATION = '1';
    deprecate('a', 'm');
    expect(notices).toHaveLength(0);

    resetDeprecations();
    process.env.VELOCE_NO_DEPRECATION = 'a, b';
    deprecate('a', 'm');
    deprecate('c', 'm');
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('deprecation c]');
  });

  it('a fresh application logs no framework deprecation', async () => {
    @Controller('/quiet')
    class C {
      @Get('/') @Public() ok() { return { ok: true }; }
    }
    await authed((app) => app.include(C), { rbac: { roles: [{ name: 'member', permissions: [] }] } });
    expect(notices).toEqual([]);
  });
});

describe('@ResponseHeader', () => {
  @Controller('/rh')
  class C {
    @Get('/one')
    @ResponseHeader('Cache-Control', 'no-store')
    one() { return { ok: true }; }

    @Get('/two')
    @ResponseHeader('X-A', '1')
    @ResponseHeader('X-B', '2')
    two() { return { ok: true }; }

    @Get('/override')
    @ResponseHeader('X-Source', 'decorator')
    override(@Ctx() c: Context) {
      c.header('X-Source', 'handler');
      return { ok: true };
    }

    @Get('/plain')
    plain() { return { ok: true }; }
  }

  it('sets the header on the response', async () => {
    const { client } = await setupTestApp((app) => app.include(C));
    const res = await client.get('/rh/one');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('stacks', async () => {
    const { client } = await setupTestApp((app) => app.include(C));
    const res = await client.get('/rh/two');
    expect(res.headers.get('x-a')).toBe('1');
    expect(res.headers.get('x-b')).toBe('2');
  });

  it('a header the handler sets itself wins', async () => {
    const { client } = await setupTestApp((app) => app.include(C));
    expect((await client.get('/rh/override')).headers.get('x-source')).toBe('handler');
  });

  it('does not leak to other routes of the controller', async () => {
    const { client } = await setupTestApp((app) => app.include(C));
    expect((await client.get('/rh/plain')).headers.get('cache-control')).toBeNull();
  });
});

describe('@Redirect', () => {
  let ran = 0;

  @Controller('/rd')
  class C {
    @Get('/old')
    @Redirect('/rd/new', 301)
    old() { ran++; return { ignored: true }; }

    @Get('/temp')
    @Redirect('https://example.com/elsewhere')
    temp() {}

    @Get('/guarded')
    @Redirect('/rd/new')
    guarded() { throw new Error('nope'); }
  }

  it('redirects with the given status after running the handler', async () => {
    ran = 0;
    const { app } = await setupTestApp((a) => a.include(C));
    const res = await app.getHono().request('/rd/old');
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('/rd/new');
    expect(ran).toBe(1);
  });

  it('defaults to 302', async () => {
    const { app } = await setupTestApp((a) => a.include(C));
    const res = await app.getHono().request('/rd/temp');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://example.com/elsewhere');
  });

  it('an error in the handler is an error, not a redirect', async () => {
    const { app } = await setupTestApp((a) => a.include(C));
    expect((await app.getHono().request('/rd/guarded')).status).toBe(500);
  });
});
