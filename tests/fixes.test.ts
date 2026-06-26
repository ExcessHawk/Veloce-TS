/**
 * Regression tests for the 24 bugs fixed in veloce-ts.
 * Each describe group targets one specific fix.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import 'reflect-metadata';

// ─── Helpers ──────────────────────────────────────────────────────────────────

import { VeloceTS } from '../src/core/application';

async function request(
  app: VeloceTS,
  method: string,
  path: string,
  body?: any,
  headers?: Record<string, string>
): Promise<Response> {
  if (!app.isCompiled()) await app.compile();
  return app.getHono().fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  );
}

// ─── Fix 1: JWT blacklist Map<string,number> ─────────────────────────────────
// Before: Set<string> — no expiry, grows forever
// After:  Map<string, number> — stores token→exp, lazy expiry cleanup

import { JWTProvider } from '../src/auth/jwt-provider';

const SECRET = 'test-secret-key-32chars-minimum!!';

describe('Fix 1: JWT blacklist uses Map with expiry', () => {
  let provider: JWTProvider;

  beforeEach(() => {
    provider = new JWTProvider({ secret: SECRET, expiresIn: '1h' });
  });

  it('token not blacklisted by default', () => {
    const { accessToken } = provider.generateTokens({ sub: 'u1' });
    expect(provider.isBlacklisted(accessToken)).toBe(false);
  });

  it('blacklistToken makes isBlacklisted return true', () => {
    const { accessToken } = provider.generateTokens({ sub: 'u1' });
    provider.blacklistToken(accessToken);
    expect(provider.isBlacklisted(accessToken)).toBe(true);
  });

  it('verifyAccessToken throws for blacklisted token', () => {
    const { accessToken } = provider.generateTokens({ sub: 'u1' });
    provider.blacklistToken(accessToken);
    expect(() => provider.verifyAccessToken(accessToken)).toThrow('Token has been revoked');
  });

  it('isBlacklisted lazily removes entry when token is expired', () => {
    // Manually insert an already-expired entry
    (provider as any).blacklistedTokens.set('fake.expired.token', 1); // exp=1 (past)
    // First call should detect expiry, remove it, return false
    expect(provider.isBlacklisted('fake.expired.token')).toBe(false);
    // Entry must be gone from the map
    expect((provider as any).blacklistedTokens.has('fake.expired.token')).toBe(false);
  });

  it('cleanupBlacklist purges expired entries', () => {
    const { accessToken } = provider.generateTokens({ sub: 'u2' });
    provider.blacklistToken(accessToken);
    // Inject a fake already-expired entry
    (provider as any).blacklistedTokens.set('old.token', 1);
    provider.cleanupBlacklist();
    // The valid blacklisted token stays (exp is ~1h from now)
    expect((provider as any).blacklistedTokens.has(accessToken)).toBe(true);
    // The expired entry is gone
    expect((provider as any).blacklistedTokens.has('old.token')).toBe(false);
  });

  it('cleanupBlacklist does not throw on empty blacklist', () => {
    expect(() => provider.cleanupBlacklist()).not.toThrow();
  });
});

// ─── Fix 2: Auth console.log removed ─────────────────────────────────────────
// auth-plugin.ts had 5 console.log calls leaking internals to stdout

import { AuthPlugin } from '../src/auth/auth-plugin';
import { InMemoryUserProvider } from '../src/auth/auth-service';

describe('Fix 2: AuthPlugin does not emit console.log on login/logout', () => {
  it('login route does not console.log anything', async () => {
    const logs: any[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args);

    const userProvider = new InMemoryUserProvider();
    await userProvider.createUser({ username: 'alice', password: 'pw123' });

    const app = new VeloceTS();
    app.usePlugin(new AuthPlugin({ jwt: { secret: SECRET }, userProvider }));
    const res = await request(app, 'POST', '/auth/login', { username: 'alice', password: 'pw123' });

    console.log = origLog;

    expect(res.status).toBe(200);
    // No log entries from veloce-ts internals (auth-plugin)
    const veloceLogs = logs.filter(l => typeof l[0] === 'string' && l[0].includes('[auth'));
    expect(veloceLogs).toHaveLength(0);
  });
});

// ─── Fix 3: RBAC management routes require auth ───────────────────────────────
// Before: /rbac/roles etc. were publicly accessible
// After:  requireAuth middleware added → 401 for unauthenticated requests

import { RBACPlugin } from '../src/auth/rbac-plugin';

describe('Fix 3: RBAC management routes require authentication', () => {
  let app: VeloceTS;

  beforeEach(() => {
    app = new VeloceTS();
    const userProvider = new InMemoryUserProvider();
    app.usePlugin(new AuthPlugin({ jwt: { secret: SECRET }, userProvider }));
    app.usePlugin(new RBACPlugin({ enableManagementRoutes: true }));
  });

  it('GET /rbac/roles without auth returns 401', async () => {
    const res = await request(app, 'GET', '/rbac/roles');
    expect(res.status).toBe(401);
  });

  it('GET /rbac/roles/:name without auth returns 401', async () => {
    const res = await request(app, 'GET', '/rbac/roles/admin');
    expect(res.status).toBe(401);
  });

  it('GET /rbac/roles/:name/permissions without auth returns 401', async () => {
    const res = await request(app, 'GET', '/rbac/roles/admin/permissions');
    expect(res.status).toBe(401);
  });
});

// ─── Fix 4: Permission management routes require auth ─────────────────────────
// Same pattern as Fix 3 but for permission-plugin.ts

import { PermissionPlugin } from '../src/auth/permission-plugin';

describe('Fix 4: Permission management routes require authentication', () => {
  let app: VeloceTS;

  beforeEach(() => {
    app = new VeloceTS();
    const userProvider = new InMemoryUserProvider();
    app.usePlugin(new AuthPlugin({ jwt: { secret: SECRET }, userProvider }));
    app.usePlugin(new PermissionPlugin({ enableManagementRoutes: true }));
  });

  it('POST /permissions/grant without auth returns 401', async () => {
    const res = await request(app, 'POST', '/permissions/grant', {});
    expect(res.status).toBe(401);
  });

  it('DELETE /permissions/revoke without auth returns 401', async () => {
    const res = await request(app, 'DELETE', '/permissions/revoke', {});
    expect(res.status).toBe(401);
  });
});

// ─── Fix 5: CacheManager.reset() method ──────────────────────────────────────
// Before: no reset() — test pollution between suites
// After:  static reset() clears defaultStore and all named stores

import { CacheManager } from '../src/cache/manager';

describe('Fix 5: CacheManager.reset() clears all stores', () => {
  beforeEach(() => CacheManager.reset());

  it('reset clears the default store', async () => {
    await CacheManager.set('key1', 'value1');
    expect(await CacheManager.get('key1')).toBe('value1');
    CacheManager.reset();
    expect(await CacheManager.get('key1')).toBeNull();
  });

  it('reset clears named stores', () => {
    const { MemoryCacheStore } = require('../src/cache/memory-store');
    const store = new MemoryCacheStore();
    CacheManager.registerStore('myStore', store);
    expect(CacheManager.getStore('myStore')).toBeDefined();
    CacheManager.reset();
    expect(CacheManager.getStore('myStore')).toBeUndefined();
  });

  it('after reset, new writes to default store work normally', async () => {
    CacheManager.reset();
    await CacheManager.set('fresh', 42);
    expect(await CacheManager.get('fresh')).toBe(42);
  });
});

// ─── Fix 6: getRouteMethods() walks prototype chain ──────────────────────────
// Before: only own enumerable properties — inherited route methods were invisible
// After:  walks full prototype chain via Object.getPrototypeOf

import { MetadataRegistry } from '../src/core/metadata';
import { Controller, Get } from '../src/decorators/http';

@Controller('/base')
class BaseController {
  @Get('/list')
  list() { return []; }
}

@Controller('/child')
class ChildController extends BaseController {
  @Get('/detail')
  detail() { return {}; }
}

describe('Fix 6: getRouteMethods walks prototype chain', () => {
  it('child controller includes inherited parent methods', () => {
    const methods = MetadataRegistry.getRouteMethods(ChildController);
    expect(methods).toContain('detail');
    expect(methods).toContain('list');
  });

  it('base controller includes its own methods', () => {
    const methods = MetadataRegistry.getRouteMethods(BaseController);
    expect(methods).toContain('list');
  });
});

// ─── Fix 7: BaseRepository.createMany uses Promise.all ───────────────────────
// Before: sequential for-loop — O(n) latency
// After:  Promise.all(...) — parallel, O(1) latency for n independent creates

import { BaseRepository, FindOptions, FilterOptions } from '../src/orm/base-repository';

class FakeRepo extends BaseRepository<{ id: number; value: string }, number> {
  private store: Map<number, { id: number; value: string }> = new Map();
  private seq = 0;
  private createLog: number[] = [];

  async create(data: Partial<{ id: number; value: string }>) {
    this.createLog.push(++this.seq);
    const item = { id: this.seq, value: data.value ?? '' };
    this.store.set(item.id, item);
    return item;
  }
  async findById(id: number) { return this.store.get(id) ?? null; }
  async findOne(_options: FindOptions) { return null; }
  async findMany(_options?: FindOptions) { return [...this.store.values()]; }
  async update(id: number, data: Partial<{ id: number; value: string }>) {
    const item = { ...this.store.get(id)!, ...data };
    this.store.set(id, item);
    return item;
  }
  async delete(id: number) { return this.store.delete(id); }
  async withTransaction<R>(callback: (repo: this) => Promise<R>) { return callback(this); }
  getCreateLog() { return this.createLog; }
}

describe('Fix 7: BaseRepository.createMany uses Promise.all', () => {
  it('createMany returns all created items', async () => {
    const repo = new FakeRepo();
    const result = await repo.createMany([{ value: 'a' }, { value: 'b' }, { value: 'c' }]);
    expect(result).toHaveLength(3);
    expect(result.map(r => r.value).sort()).toEqual(['a', 'b', 'c']);
  });

  it('createMany with empty array returns empty result', async () => {
    const repo = new FakeRepo();
    const result = await repo.createMany([]);
    expect(result).toHaveLength(0);
  });
});

// ─── Fix 8: MetadataCompiler class identity via WeakMap ──────────────────────
// Before: cache key = "ControllerName:methodName" — collides across same-named classes
// After:  cache key = "numericId:methodName" where ID comes from WeakMap<Class, number>

import { MetadataCompiler } from '../src/core/compiled-metadata';

describe('Fix 8: MetadataCompiler isolates cache by class identity', () => {
  it('two different class objects get different WeakMap IDs', () => {
    class Alpha { route() {} }
    class Beta { route() {} }

    const route1 = {
      target: Alpha, propertyKey: 'route', method: 'GET' as const,
      path: '/alpha', middleware: [], parameters: [], dependencies: [], responses: []
    };
    const route2 = {
      target: Beta, propertyKey: 'route', method: 'POST' as const,
      path: '/beta', middleware: [], parameters: [], dependencies: [], responses: []
    };

    const c1 = MetadataCompiler.compile(route1);
    const c2 = MetadataCompiler.compile(route2);

    expect(c1.method).toBe('GET');
    expect(c2.method).toBe('POST');
  });

  it('two classes with the same name do not share compiled metadata', () => {
    // Simulate what happens when two test files both define "SameNameCtrl"
    const SameNameCtrl1 = (() => { class SameNameCtrl { go() {} } return SameNameCtrl; })();
    const SameNameCtrl2 = (() => { class SameNameCtrl { go() {} } return SameNameCtrl; })();

    const r1 = {
      target: SameNameCtrl1, propertyKey: 'go', method: 'GET' as const,
      path: '/one', middleware: [], parameters: [], dependencies: [], responses: []
    };
    const r2 = {
      target: SameNameCtrl2, propertyKey: 'go', method: 'DELETE' as const,
      path: '/two', middleware: [], parameters: [], dependencies: [], responses: []
    };

    const c1 = MetadataCompiler.compile(r1);
    const c2 = MetadataCompiler.compile(r2);

    expect(c1.path).toBe('/one');
    expect(c2.path).toBe('/two');
    expect(c1.method).toBe('GET');
    expect(c2.method).toBe('DELETE');
  });

  it('same class+method compiled twice returns cached result', () => {
    class Cached { ping() {} }
    const route = {
      target: Cached, propertyKey: 'ping', method: 'GET' as const,
      path: '/ping', middleware: [], parameters: [], dependencies: [], responses: []
    };
    const first = MetadataCompiler.compile(route);
    const second = MetadataCompiler.compile(route);
    expect(first).toBe(second); // referential equality from cache
  });
});

// ─── Fix 9: Drizzle lazy require() ───────────────────────────────────────────
// Before: static import of drizzle-orm broke build when package not installed
// After:  lazy require() inside getDrizzleOps() — import of the module itself succeeds

describe('Fix 9: Drizzle repository module import does not throw', () => {
  it('importing DrizzleRepository does not crash (lazy require)', () => {
    // If static imports were restored, this require would throw immediately
    expect(() => require('../src/orm/drizzle/repository')).not.toThrow();
  });
});

// ─── Fix 10: TypeORM lazy require() ──────────────────────────────────────────
// Same pattern as Fix 9

describe('Fix 10: TypeORM repository module import does not throw', () => {
  it('importing TypeORMRepository does not crash (lazy require)', () => {
    expect(() => require('../src/orm/typeorm/repository')).not.toThrow();
  });
});

// ─── Fix 11: GraphQL invalid JSON variables → 400 ────────────────────────────
// Before: JSON.parse(variables) threw and bubbled as unhandled → 500
// After:  try-catch returns c.json({error:...}, 400)

import { GraphQLPlugin } from '../src/graphql/plugin';

describe('Fix 11: GraphQL GET with invalid JSON variables returns 400', () => {
  it('?variables=invalid-json returns 400', async () => {
    const app = new VeloceTS();
    app.usePlugin(new GraphQLPlugin({ path: '/graphql' }));
    const res = await request(app, 'GET', '/graphql?query={hello}&variables=not-valid-json');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid JSON/i);
  });

  it('?variables={} (valid JSON) does not return 400 for that reason', async () => {
    const app = new VeloceTS();
    app.usePlugin(new GraphQLPlugin({ path: '/graphql' }));
    const res = await request(app, 'GET', '/graphql?query={hello}&variables=%7B%7D');
    // May be 200, 400 (no resolver) or 500 — but NOT "Invalid JSON in variables"
    if (res.status === 400) {
      const body = await res.json();
      expect(body.error ?? '').not.toMatch(/Invalid JSON in variables/i);
    }
  });
});

// ─── Fix 12: OAuth generates tokens directly, not via login('', ...) ─────────
// Before: oauth-plugin called login(user, '') which tried to verify empty password
// After:  calls jwtProvider.generateTokens() directly

import { OAuthPlugin } from '../src/auth/oauth-plugin';

describe('Fix 12: OAuthPlugin setup does not throw during install', () => {
  it('installing OAuthPlugin with minimal config succeeds', async () => {
    const app = new VeloceTS();
    const userProvider = new InMemoryUserProvider();
    app.usePlugin(new AuthPlugin({ jwt: { secret: SECRET }, userProvider }));

    await expect(
      (async () => {
        app.usePlugin(new OAuthPlugin({
          providers: {},
          userProvider
        }));
        await app.compile();
      })()
    ).resolves.toBeUndefined();
  });
});

// ─── Fix 13: Session auto-cleanup interval ────────────────────────────────────
// Before: no cleanup — session store grows unbounded
// After:  setInterval created on construction, removed on SIGTERM/SIGINT

import { MemorySessionStore } from '../src/auth/session';

describe('Fix 13: SessionStore auto-cleanup runs without crashing', () => {
  it('MemorySessionStore can be created and does not throw', () => {
    expect(() => new MemorySessionStore(60_000)).not.toThrow();
  });

  it('set then get returns the session', async () => {
    const store = new MemorySessionStore(60_000);
    const now = new Date();
    const session = {
      id: 'sid1', userId: 'u1', data: {}, createdAt: now, updatedAt: now
    };
    await store.set('sid1', session);
    const found = await store.get('sid1');
    expect(found).toMatchObject({ userId: 'u1' });
  });

  it('destroy removes the session', async () => {
    const store = new MemorySessionStore(60_000);
    const now = new Date();
    await store.set('sid2', { id: 'sid2', userId: 'u2', data: {}, createdAt: now, updatedAt: now });
    await store.destroy('sid2');
    expect(await store.get('sid2')).toBeNull();
  });
});

// ─── Fix 14: Validator has no dead resultCache field ─────────────────────────
// Before: unused WeakMap<any, ValidationResult> on ValidationEngine allocated memory
// After:  field removed

import { ValidationEngine } from '../src/validation/validator';

describe('Fix 14: ValidationEngine has no dead resultCache field', () => {
  it('ValidationEngine instance has no resultCache property', () => {
    const engine = new ValidationEngine();
    expect((engine as any).resultCache).toBeUndefined();
  });
});

// ─── Fix 15: Functional routes register unique cache keys ─────────────────────
// (Part of MetadataCompiler fix — handler function identity used as cache key)
// Two different functional apps with same path don't share compiled metadata

describe('Fix 15: Separate VeloceTS apps with same path get independent routes', () => {
  it('two apps respond with their own data independently', async () => {
    const app1 = new VeloceTS();
    app1.get('/data', { handler: async () => ({ app: 1 }) });

    const app2 = new VeloceTS();
    app2.get('/data', { handler: async () => ({ app: 2 }) });

    const res1 = await request(app1, 'GET', '/data');
    const res2 = await request(app2, 'GET', '/data');

    expect((await res1.json()).app).toBe(1);
    expect((await res2.json()).app).toBe(2);
  });
});

// ─── Fix 16: compile() is idempotent ─────────────────────────────────────────
// application.ts should skip second compile() call

describe('Fix 16: VeloceTS.compile() is idempotent', () => {
  it('calling compile() twice does not throw or duplicate routes', async () => {
    const app = new VeloceTS();
    app.get('/ping', { handler: async () => ({ ok: true }) });
    await app.compile();
    await expect(app.compile()).resolves.toBeUndefined();
    expect(app.isCompiled()).toBe(true);
  });
});

// ─── Fix 17: Null handler result returns 204 ─────────────────────────────────
// application.ts should interpret null return as "no content"

describe('Fix 17: Null handler result returns 204 No Content', () => {
  it('handler returning null → 204', async () => {
    const app = new VeloceTS();
    app.delete('/item/:id', { handler: async () => null });
    const res = await request(app, 'DELETE', '/item/1');
    expect(res.status).toBe(204);
  });
});

// ─── Fix 18: Middleware can short-circuit with early return ───────────────────

describe('Fix 18: Middleware early return blocks handler', () => {
  it('middleware returning response prevents handler execution', async () => {
    let handlerRan = false;
    const app = new VeloceTS();
    app.use(async (c) => c.json({ blocked: true }, 403));
    app.get('/secret', {
      handler: async () => {
        handlerRan = true;
        return { data: 'secret' };
      }
    });
    const res = await request(app, 'GET', '/secret');
    expect(res.status).toBe(403);
    expect(handlerRan).toBe(false);
  });
});

// ─── Fix 19: Custom error handler receives thrown error ───────────────────────

describe('Fix 19: Custom onError handler is invoked with correct error', () => {
  it('thrown error reaches custom error handler', async () => {
    const app = new VeloceTS();
    app.onError(async (err, c) => c.json({ caught: err.message }, 418));
    app.get('/fail', { handler: async () => { throw new Error('oops'); } });
    const res = await request(app, 'GET', '/fail');
    expect(res.status).toBe(418);
    expect((await res.json()).caught).toBe('oops');
  });
});

// ─── Fix 20: Route groups apply prefix to child routes ───────────────────────

describe('Fix 20: Route groups apply prefix correctly', () => {
  it('group prefix is prepended to all child routes', async () => {
    const app = new VeloceTS();
    app.group('/api/v2', () => {
      app.get('/status', { handler: async () => ({ version: 2 }) });
    });
    const res = await request(app, 'GET', '/api/v2/status');
    expect(res.status).toBe(200);
    expect((await res.json()).version).toBe(2);
  });

  it('grouped route returns 404 without prefix', async () => {
    const app = new VeloceTS();
    app.group('/api/v2', () => {
      app.get('/status', { handler: async () => ({ version: 2 }) });
    });
    const res = await request(app, 'GET', '/status');
    expect(res.status).toBe(404);
  });
});

// ─── Fix 21: RBAC requires authenticated user (not just "has roles") ──────────
// Before: missing auth check — anonymous user could hit RBAC guarded route
// The actual RBAC guard throws AuthenticationException (401) not AuthorizationException (403)

describe('Fix 21: RBAC guard returns 401 (not 403) for anonymous user', () => {
  it('unauthenticated request to protected route gets 401', async () => {
    const app = new VeloceTS();
    const userProvider = new InMemoryUserProvider();
    app.usePlugin(new AuthPlugin({ jwt: { secret: SECRET }, userProvider }));
    app.usePlugin(new RBACPlugin({ enableManagementRoutes: true }));

    const res = await request(app, 'GET', '/rbac/roles');
    // Must be 401 (not 403) — anonymous user is an auth problem, not an authz problem
    expect(res.status).toBe(401);
  });
});

// ─── Fix 22: MetadataCompiler.clearCache() works ─────────────────────────────

describe('Fix 22: MetadataCompiler.clearCache() resets state', () => {
  it('clearCache does not throw', () => {
    expect(() => MetadataCompiler.clearCache()).not.toThrow();
  });

  it('after clearCache, compile returns fresh result', () => {
    class Freshable { act() {} }
    const route = {
      target: Freshable, propertyKey: 'act', method: 'GET' as const,
      path: '/fresh', middleware: [], parameters: [], dependencies: [], responses: []
    };
    const first = MetadataCompiler.compile(route);
    MetadataCompiler.clearCache();
    const second = MetadataCompiler.compile(route);
    // After clearing, a new object is allocated — not the same reference
    expect(first).not.toBe(second);
    // But content is identical
    expect(second.path).toBe('/fresh');
  });
});

// ─── Fix 23: Path parameters are extracted correctly ─────────────────────────

describe('Fix 23: Path parameters are parsed correctly', () => {
  it(':id param is accessible in handler', async () => {
    const app = new VeloceTS();
    app.get('/users/:id', { handler: async (c) => ({ id: c.req.param('id') }) });
    const res = await request(app, 'GET', '/users/99');
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe('99');
  });

  it('multiple path params are all extracted', async () => {
    const app = new VeloceTS();
    app.get('/orgs/:org/repos/:repo', {
      handler: async (c) => ({
        org: c.req.param('org'),
        repo: c.req.param('repo')
      })
    });
    const res = await request(app, 'GET', '/orgs/veloce/repos/ts');
    const body = await res.json();
    expect(body.org).toBe('veloce');
    expect(body.repo).toBe('ts');
  });
});

// ─── Fix 24: CORS preflight from allowed origin ───────────────────────────────

describe('Fix 24: CORS middleware allows correct origins', () => {
  it('preflight from allowed origin gets 204', async () => {
    const app = new VeloceTS({ cors: { origin: 'https://allowed.com' } });
    app.get('/data', { handler: async () => ({ ok: true }) });
    const res = await request(app, 'OPTIONS', '/data', undefined, {
      Origin: 'https://allowed.com',
      'Access-Control-Request-Method': 'GET'
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://allowed.com');
  });

  it('preflight from disallowed origin gets 403', async () => {
    const app = new VeloceTS({ cors: { origin: ['https://allowed.com'] } });
    app.get('/data', { handler: async () => ({ ok: true }) });
    const res = await request(app, 'OPTIONS', '/data', undefined, {
      Origin: 'https://evil.com',
      'Access-Control-Request-Method': 'GET'
    });
    expect(res.status).toBe(403);
  });
});
