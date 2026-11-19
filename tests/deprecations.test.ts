/**
 * v3.9.0: notices for behavior that changes in v4.0.0, and the two decorators
 * that used to be inert and now take effect.
 */
import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import 'reflect-metadata';
import { VeloceTS } from '../src/core/application';
import { Controller, Get } from '../src/decorators/http';
import { ResponseHeader, Redirect, Throttle, ApiVersion } from '../src/decorators/extras';
import { Ctx } from '../src/decorators/params';
import { AuthPlugin } from '../src/auth/auth-plugin';
import { RBACPlugin } from '../src/auth/rbac-plugin';
import { Auth, Public } from '../src/auth/decorators';
import { InMemoryUserProvider } from '../src/auth/auth-service';
import { deprecate, resetDeprecations } from '../src/logging/deprecation';
import { getLogger } from '../src/logging/logger';
import { setupTestApp } from '../src/testing/helpers';
import type { Context } from 'hono';

const SECRET = 'test-secret-key-32chars-minimum!!';

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

const has = (code: string) => notices.some((n) => n.includes(`deprecation ${code}]`));

function authPlugin(extra: Record<string, unknown> = {}) {
  return new AuthPlugin({
    jwt: { secret: SECRET },
    userProvider: new InMemoryUserProvider(),
    enableDefaultRoutes: false,
    ...extra,
  });
}

describe('deprecate()', () => {
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
});

describe('RBACPlugin notices', () => {
  const roles = [{ name: 'member', permissions: [] }];

  it('warns when the management routes are on only by default', async () => {
    const app = new VeloceTS({ docs: false });
    app.usePlugin(authPlugin({ requireAuthByDefault: false }));
    app.usePlugin(new RBACPlugin({ roles, useDefaults: false }));
    await app.compile();
    expect(has('rbac-management-routes')).toBe(true);
    expect(has('rbac-default-roles')).toBe(false);
  });

  it('warns when default roles are created next to user-defined ones', async () => {
    const app = new VeloceTS({ docs: false });
    app.usePlugin(authPlugin({ requireAuthByDefault: false }));
    app.usePlugin(new RBACPlugin({ roles, enableManagementRoutes: false }));
    await app.compile();
    expect(has('rbac-default-roles')).toBe(true);
    expect(has('rbac-management-routes')).toBe(false);
  });

  it('is silent when both options are explicit, whichever way', async () => {
    const app = new VeloceTS({ docs: false });
    app.usePlugin(authPlugin({ requireAuthByDefault: false }));
    app.usePlugin(new RBACPlugin({ roles, useDefaults: true, enableManagementRoutes: true }));
    await app.compile();
    expect(has('rbac-default-roles')).toBe(false);
    expect(has('rbac-management-routes')).toBe(false);
  });

  it('does not warn about default roles when the app defines none of its own', async () => {
    const app = new VeloceTS({ docs: false });
    app.usePlugin(authPlugin({ requireAuthByDefault: false }));
    app.usePlugin(new RBACPlugin({ enableManagementRoutes: false }));
    await app.compile();
    expect(has('rbac-default-roles')).toBe(false);
  });
});

describe('AuthPlugin notice for routes that are public by omission', () => {
  @Controller('/dep')
  class Mixed {
    @Get('/undecided')
    undecided() { return {}; }

    @Get('/open')
    @Public()
    open() { return {}; }

    @Get('/closed')
    @Auth()
    closed() { return {}; }
  }

  it('names the undecided routes, and only those', async () => {
    const app = new VeloceTS({ docs: false });
    app.usePlugin(authPlugin());
    app.include(Mixed);
    await app.compile();

    const notice = notices.find((n) => n.includes('auth-public-by-default'));
    expect(notice).toBeDefined();
    expect(notice).toContain('1 route(s)');
    expect(notice).toContain('GET /dep/undecided');
    expect(notice).not.toContain('/dep/open');
    expect(notice).not.toContain('/dep/closed');
  });

  it('is silent once requireAuthByDefault is set, to either value', async () => {
    for (const value of [true, false]) {
      resetDeprecations();
      notices = [];
      const app = new VeloceTS({ docs: false });
      app.usePlugin(authPlugin({ requireAuthByDefault: value }));
      app.include(Mixed);
      await app.compile();
      expect(has('auth-public-by-default')).toBe(false);
    }
  });

  it('is silent when every route has decided', async () => {
    @Controller('/dep2')
    @Auth()
    class AllDecided {
      @Get('/a') a() { return {}; }
      @Get('/b') @Public() b() { return {}; }
    }
    const app = new VeloceTS({ docs: false });
    app.usePlugin(authPlugin());
    app.include(AllDecided);
    await app.compile();
    expect(has('auth-public-by-default')).toBe(false);
  });

  it('does not change behavior: the undecided route is still public in 3.x', async () => {
    const app = new VeloceTS({ docs: false });
    app.usePlugin(authPlugin());
    app.include(Mixed);
    await app.compile();
    expect((await app.getHono().request('/dep/undecided')).status).toBe(200);
  });
});

describe('error detail notice', () => {
  const original = process.env.NODE_ENV;
  afterEach(() => { process.env.NODE_ENV = original; });

  it('warns when detail is exposed only because NODE_ENV is unset or unknown', async () => {
    process.env.NODE_ENV = 'staging';
    const app = new VeloceTS({ docs: false });
    await app.compile();
    expect(has('error-detail-by-omission')).toBe(true);
  });

  it('is silent for development, test and production', async () => {
    for (const env of ['development', 'test', 'production']) {
      resetDeprecations();
      notices = [];
      process.env.NODE_ENV = env;
      const app = new VeloceTS({ docs: false });
      await app.compile();
      expect(has('error-detail-by-omission')).toBe(false);
    }
  });
});

describe('@Throttle and @ApiVersion', () => {
  it('say that they do nothing', () => {
    class C {
      @Throttle(5, 1000)
      a() {}

      @ApiVersion('2')
      b() {}
    }
    void C;
    expect(notices.find((n) => n.includes('throttle-decorator'))).toContain('NOT rate limited');
    expect(has('api-version-decorator')).toBe(true);
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
    guarded() { throw Object.assign(new Error('nope'), {}); }
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
