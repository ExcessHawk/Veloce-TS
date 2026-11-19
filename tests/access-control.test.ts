/**
 * Access control that does not depend on remembering a decorator per route:
 *
 * - request-scoped roles (`RBACPluginConfig.resolveRoles`), for applications
 *   where the role depends on the tenant chosen per request;
 * - class-level `@Auth` / `@Roles`, and `@Public` as the explicit exception;
 * - `AuthPluginConfig.requireAuthByDefault` (deny by default);
 * - guards on routes registered by plugins installed after the auth plugin.
 */
import { describe, it, expect } from 'bun:test';
import 'reflect-metadata';
import type { Context } from 'hono';
import { VeloceTS } from '../src/core/application';
import { Controller, Get, Post } from '../src/decorators/http';
import { Auth, Public } from '../src/auth/decorators';
import { Roles, MinimumRole, Permissions, getUserRoles } from '../src/auth/rbac-decorators';
import { Ctx } from '../src/decorators/params';
import { AuthPlugin, type AuthPluginConfig } from '../src/auth/auth-plugin';
import { RBACPlugin, type RBACPluginConfig } from '../src/auth/rbac-plugin';
import { InMemoryUserProvider } from '../src/auth/auth-service';
import { ForbiddenException } from '../src/errors/exceptions';
import type { Plugin } from '../src/core/plugin';

const SECRET = 'test-secret-key-32chars-minimum!!';

async function build(
  setup: (app: VeloceTS) => void,
  opts: {
    tokenRoles?: string[];
    auth?: Partial<AuthPluginConfig>;
    rbac?: RBACPluginConfig | false;
    plugins?: Plugin[];
  } = {}
) {
  const userProvider = new InMemoryUserProvider();
  await userProvider.createUser({
    username: 'alice',
    password: 'secret1',
    roles: opts.tokenRoles ?? ['member'],
  });
  const auth = new AuthPlugin({
    jwt: { secret: SECRET },
    userProvider,
    enableDefaultRoutes: false,
    ...opts.auth,
  });
  const app = new VeloceTS({ docs: false });
  app.usePlugin(auth);
  if (opts.rbac !== false) {
    app.usePlugin(
      new RBACPlugin({
        useDefaults: false,
        enableManagementRoutes: false,
        roles: [
          { name: 'owner', permissions: ['*'], level: 100 },
          { name: 'member', permissions: ['docs:read'], level: 10 },
        ],
        ...opts.rbac,
      })
    );
  }
  for (const p of opts.plugins ?? []) app.usePlugin(p);
  setup(app);
  await app.compile();
  const { tokens } = await auth.getAuthService().login('alice', 'secret1');
  const call = (path: string, init: { method?: string; headers?: Record<string, string>; anonymous?: boolean } = {}) =>
    app.getHono().request(path, {
      method: init.method ?? 'GET',
      headers: {
        ...(init.anonymous ? {} : { Authorization: `Bearer ${tokens.accessToken}` }),
        ...init.headers,
      },
    });
  return { app, call };
}

// ─── resolveRoles ────────────────────────────────────────────────────────────

describe('RBACPlugin resolveRoles — roles depend on the request, not the token', () => {
  // The token says `owner` everywhere; the real role depends on the tenant
  // named by the request. This is the multi-tenant shape: one user, a
  // different role per organization, organization chosen per request.
  const membership: Record<string, string> = { 'org-a': 'owner', 'org-b': 'member' };

  const resolveRoles = (c: Context) => {
    const org = c.req.header('X-Org-ID') ?? '';
    const role = membership[org];
    if (!role) throw new ForbiddenException('Not a member of this organization');
    return [role];
  };

  @Controller('/rr')
  class C {
    @Post('/settings')
    @Roles(['owner'])
    settings() {
      return { ok: true };
    }

    @Get('/whoami')
    @Roles(['owner', 'member'])
    whoami(@Ctx() c: Context) {
      return { roles: getUserRoles(c) };
    }

    @Get('/level')
    @MinimumRole('owner')
    level() {
      return { ok: true };
    }

    @Get('/perm')
    @Permissions(['billing:write'])
    perm() {
      return { ok: true };
    }
  }

  it('grants where the user really holds the role', async () => {
    const { call } = await build((app) => app.include(C), { tokenRoles: ['owner'], rbac: { resolveRoles } });
    const res = await call('/rr/settings', { method: 'POST', headers: { 'X-Org-ID': 'org-a' } });
    expect(res.status).toBe(200);
  });

  it('denies in a tenant where the user is only a member, even though the token says owner', async () => {
    const { call } = await build((app) => app.include(C), { tokenRoles: ['owner'], rbac: { resolveRoles } });
    const res = await call('/rr/settings', { method: 'POST', headers: { 'X-Org-ID': 'org-b' } });
    expect(res.status).toBe(403);
  });

  it('without the hook the token role wins (the behavior the hook exists to replace)', async () => {
    const { call } = await build((app) => app.include(C), { tokenRoles: ['owner'] });
    const res = await call('/rr/settings', { method: 'POST', headers: { 'X-Org-ID': 'org-b' } });
    expect(res.status).toBe(200);
  });

  it('applies to @MinimumRole and @Permissions as well', async () => {
    const { call } = await build((app) => app.include(C), { tokenRoles: ['owner'], rbac: { resolveRoles } });
    expect((await call('/rr/level', { headers: { 'X-Org-ID': 'org-a' } })).status).toBe(200);
    expect((await call('/rr/level', { headers: { 'X-Org-ID': 'org-b' } })).status).toBe(403);
    expect((await call('/rr/perm', { headers: { 'X-Org-ID': 'org-a' } })).status).toBe(200);
    expect((await call('/rr/perm', { headers: { 'X-Org-ID': 'org-b' } })).status).toBe(403);
  });

  it('exposes the resolved roles to the handler through getUserRoles', async () => {
    const { call } = await build((app) => app.include(C), { tokenRoles: ['owner'], rbac: { resolveRoles } });
    const res = await call('/rr/whoami', { headers: { 'X-Org-ID': 'org-b' } });
    expect(await res.json()).toEqual({ roles: ['member'] });
  });

  it('lets the hook reject the request outright', async () => {
    const { call } = await build((app) => app.include(C), { tokenRoles: ['owner'], rbac: { resolveRoles } });
    const res = await call('/rr/whoami', { headers: { 'X-Org-ID': 'org-unknown' } });
    expect(res.status).toBe(403);
  });

  it('is not consulted for anonymous requests (still 401)', async () => {
    let called = 0;
    const { call } = await build((app) => app.include(C), {
      rbac: { resolveRoles: () => { called++; return ['owner']; } },
    });
    const res = await call('/rr/settings', { method: 'POST', anonymous: true });
    expect(res.status).toBe(401);
    expect(called).toBe(0);
  });
});

// ─── class-level decorators + @Public ────────────────────────────────────────

describe('class-level @Roles / @Auth and @Public', () => {
  @Controller('/cl')
  @Roles(['owner'])
  class OwnersOnly {
    @Get('/inherits')
    inherits() {
      return { ok: true };
    }

    @Get('/overrides')
    @Roles(['member'])
    overrides() {
      return { ok: true };
    }

    @Get('/open')
    @Public()
    open() {
      return { ok: true };
    }
  }

  it('a route with no decorator inherits the class rule', async () => {
    const asMember = await build((app) => app.include(OwnersOnly), { tokenRoles: ['member'] });
    expect((await asMember.call('/cl/inherits')).status).toBe(403);
    expect((await asMember.call('/cl/inherits', { anonymous: true })).status).toBe(401);

    const asOwner = await build((app) => app.include(OwnersOnly), { tokenRoles: ['owner'] });
    expect((await asOwner.call('/cl/inherits')).status).toBe(200);
  });

  it('a method-level @Roles replaces the class rule', async () => {
    const { call } = await build((app) => app.include(OwnersOnly), { tokenRoles: ['member'] });
    expect((await call('/cl/overrides')).status).toBe(200);
  });

  it('@Public opts a single route out', async () => {
    const { call } = await build((app) => app.include(OwnersOnly), { tokenRoles: ['member'] });
    expect((await call('/cl/open', { anonymous: true })).status).toBe(200);
  });

  it('class-level @Auth protects every route without the RBAC plugin', async () => {
    @Controller('/cla')
    @Auth()
    class Protected {
      @Get('/a')
      a() { return { ok: true }; }

      @Get('/b')
      @Public()
      b() { return { ok: true }; }
    }
    const { call } = await build((app) => app.include(Protected), { rbac: false });
    expect((await call('/cla/a', { anonymous: true })).status).toBe(401);
    expect((await call('/cla/a')).status).toBe(200);
    expect((await call('/cla/b', { anonymous: true })).status).toBe(200);
  });

  it('a subclass inherits the class-level rule of its base controller', async () => {
    @Roles(['owner'])
    class Base {}

    @Controller('/sub')
    class Child extends Base {
      @Get('/x')
      x() { return { ok: true }; }
    }
    const { call } = await build((app) => app.include(Child), { tokenRoles: ['member'] });
    expect((await call('/sub/x')).status).toBe(403);
  });
});

// ─── requireAuthByDefault ────────────────────────────────────────────────────

describe('AuthPlugin requireAuthByDefault', () => {
  @Controller('/dd')
  class Mixed {
    @Get('/forgot')          // no access decorator at all
    forgot() { return { ok: true }; }

    @Get('/open')
    @Public()
    open() { return { ok: true }; }

    @Get('/optional')
    @Auth({ optional: true })
    optional() { return { ok: true }; }
  }

  it('is the default since v4.0.0: an undecorated route requires a token', async () => {
    const { call } = await build((app) => app.include(Mixed));
    expect((await call('/dd/forgot', { anonymous: true })).status).toBe(401);
    expect((await call('/dd/forgot')).status).toBe(200);
  });

  it('requireAuthByDefault: false restores public-unless-decorated', async () => {
    const { call } = await build((app) => app.include(Mixed), { auth: { requireAuthByDefault: false } });
    expect((await call('/dd/forgot', { anonymous: true })).status).toBe(200);
  });

  it('on: an undecorated route requires a token', async () => {
    const { call } = await build((app) => app.include(Mixed), { auth: { requireAuthByDefault: true } });
    expect((await call('/dd/forgot', { anonymous: true })).status).toBe(401);
    expect((await call('/dd/forgot')).status).toBe(200);
  });

  it('on: @Public and @Auth({ optional: true }) stay reachable', async () => {
    const { call } = await build((app) => app.include(Mixed), { auth: { requireAuthByDefault: true } });
    expect((await call('/dd/open', { anonymous: true })).status).toBe(200);
    expect((await call('/dd/optional', { anonymous: true })).status).toBe(200);
  });

  it('on: functional routes follow the same rule, with `public: true` as the opt-out', async () => {
    const { call } = await build(
      (app) => {
        app.get('/fn/closed', { handler: () => ({ ok: true }) });
        app.get('/fn/open', { handler: () => ({ ok: true }), public: true });
      },
      { auth: { requireAuthByDefault: true } }
    );
    expect((await call('/fn/closed', { anonymous: true })).status).toBe(401);
    expect((await call('/fn/open', { anonymous: true })).status).toBe(200);
  });

  it('on: the built-in login route stays public', async () => {
    const { app } = await build(() => {}, {
      auth: { requireAuthByDefault: true, enableDefaultRoutes: true },
    });
    const res = await app.getHono().request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'secret1' }),
    });
    expect(res.status).toBe(200);
  });

  it('on: covers routes registered by a plugin installed AFTER the auth plugin', async () => {
    const late: Plugin = {
      name: 'late-routes',
      dependencies: ['auth'],
      install(app) {
        app.get('/late/data', { handler: () => ({ secret: true }) });
      },
    };
    const { call } = await build(() => {}, { auth: { requireAuthByDefault: true }, plugins: [late] });
    expect((await call('/late/data', { anonymous: true })).status).toBe(401);
    expect((await call('/late/data')).status).toBe(200);
  });
});
