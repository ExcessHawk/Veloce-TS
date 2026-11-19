/**
 * The multi-tenant recipe from the README, executed.
 *
 * A README example that does not run is worse than none, and this one depends
 * on ordering between four features (auth, an `afterPlugins` tenant middleware,
 * `resolveRoles`, and `onBegin` of the per-request transaction). If this file
 * needs to change, the README section "Multi-tenant applications" does too.
 */
import { describe, it, expect } from 'bun:test';
import 'reflect-metadata';
import { Database } from 'bun:sqlite';
import { VeloceTS } from '../src/core/application';
import { Controller, Get, Post } from '../src/decorators/http';
import { createParamDecorator } from '../src/decorators/params';
import { AuthPlugin } from '../src/auth/auth-plugin';
import { RBACPlugin } from '../src/auth/rbac-plugin';
import { Roles } from '../src/auth/rbac-decorators';
import { Public } from '../src/auth/decorators';
import { InMemoryUserProvider } from '../src/auth/auth-service';
import { ForbiddenException } from '../src/errors/exceptions';
import { registerDrizzle, InjectDB } from '../src/dependencies/drizzle';

const SECRET = 'test-secret-key-32chars-minimum!!';

interface Tenant { id: string; memberId: string; role: string }

/** Async-transaction handle over real SQLite (see ambient-transactions.test.ts). */
function makeDb() {
  const sqlite = new Database(':memory:');
  sqlite.run('CREATE TABLE projects (org TEXT NOT NULL, name TEXT NOT NULL)');
  const log: string[] = [];
  const handle = (inTx: boolean): any => ({
    insert(org: string, name: string) { sqlite.run('INSERT INTO projects (org, name) VALUES (?, ?)', [org, name]); },
    list(org: string) {
      return (sqlite.query('SELECT name FROM projects WHERE org = ? ORDER BY rowid').all(org) as { name: string }[]).map((r) => r.name);
    },
    note(text: string) { log.push(text); },
    async transaction(cb: (tx: any) => Promise<unknown>) {
      if (inTx) return cb(handle(true));
      sqlite.run('BEGIN');
      try { const r = await cb(handle(true)); sqlite.run('COMMIT'); return r; }
      catch (e) { sqlite.run('ROLLBACK'); throw e; }
    },
  });
  return { db: handle(false), log };
}

async function build() {
  // user id -> org -> role
  const memberships: Record<string, Record<string, string>> = {};

  const userProvider = new InMemoryUserProvider();
  const alice = await userProvider.createUser({ username: 'alice', password: 'secret1', roles: ['owner'] });
  memberships[alice.id] = { 'org-a': 'owner', 'org-b': 'member' };

  const { db, log } = makeDb();
  const app = new VeloceTS({ docs: false });
  const auth = new AuthPlugin({ jwt: { secret: SECRET }, userProvider, enableDefaultRoutes: false, requireAuthByDefault: true });
  app.usePlugin(auth);

  // 1. tenant, once per request, after authentication
  app.use(async (c, next) => {
    const user = c.get('auth.user');
    const orgId = c.req.header('X-Org-ID');
    if (user && orgId) {
      const role = memberships[String(user.sub)]?.[orgId];
      if (!role) throw new ForbiddenException('Not a member of this organization');
      (c as any).set('tenant', { id: orgId, memberId: `${user.sub}@${orgId}`, role } satisfies Tenant);
    }
    await next();
  }, { phase: 'afterPlugins' });

  // 2. roles from the membership
  app.usePlugin(new RBACPlugin({
    useDefaults: false,
    enableManagementRoutes: false,
    roles: [
      { name: 'owner', permissions: ['*'], level: 100, inherits: ['member'] },
      { name: 'member', permissions: [], level: 10 },
    ],
    resolveRoles: (c) => {
      const tenant = (c as any).get('tenant') as Tenant | undefined;
      if (!tenant) throw new ForbiddenException('X-Org-ID header required');
      return [tenant.role];
    },
  }));

  // 3. tenant as a parameter
  const CurrentTenant = createParamDecorator<Tenant>((c) => (c as any).get('tenant'));

  // 4. per-user limiter
  app.useRateLimit({ windowMs: 60_000, max: 300, keyBy: 'user-or-ip', trustedProxyHops: 1 });

  // 5. tenant known when the transaction begins
  registerDrizzle(app, db, {
    transactionPerRequest: (c) => c.req.method !== 'GET',
    onBegin: (tx, c) => {
      const tenant = (c as any)?.get('tenant') as Tenant | undefined;
      tx.note(`begin tenant=${tenant?.id ?? 'none'}`);
    },
  });

  @Controller('/projects')
  @Roles(['member'])
  class ProjectsController {
    constructor(@InjectDB() private db: any) {}

    @Get('/')
    list(@CurrentTenant() tenant: Tenant) {
      return { org: tenant.id, role: tenant.role, projects: this.db.list(tenant.id) };
    }

    @Post('/')
    @Roles(['owner'])
    create(@CurrentTenant() tenant: Tenant) {
      this.db.insert(tenant.id, 'new project');
      return { ok: true };
    }

    @Get('/ping')
    @Public()
    ping() { return { pong: true }; }
  }

  app.include(ProjectsController);
  await app.compile();

  const { tokens } = await auth.getAuthService().login('alice', 'secret1');
  const call = (method: string, path: string, org?: string, anonymous = false) =>
    app.getHono().request(path, {
      method,
      headers: {
        ...(anonymous ? {} : { Authorization: `Bearer ${tokens.accessToken}` }),
        ...(org ? { 'X-Org-ID': org } : {}),
      },
    });

  return { call, db, log };
}

describe('README: multi-tenant recipe', () => {
  it('the same user is an owner in one organization and only a member in another', async () => {
    const { call } = await build();

    // The token says `owner`; what counts is the membership in the requested org
    expect((await call('POST', '/projects', 'org-a')).status).toBe(200);
    expect((await call('POST', '/projects', 'org-b')).status).toBe(403);

    // …while reading is allowed in both (owner inherits member)
    expect(await (await call('GET', '/projects', 'org-a')).json()).toEqual({ org: 'org-a', role: 'owner', projects: ['new project'] });
    expect(await (await call('GET', '/projects', 'org-b')).json()).toEqual({ org: 'org-b', role: 'member', projects: [] });
  });

  it('an organization the user does not belong to, or none at all, is refused', async () => {
    const { call } = await build();
    expect((await call('GET', '/projects', 'org-zzz')).status).toBe(403);
    expect((await call('GET', '/projects')).status).toBe(403);
  });

  it('anonymous requests get 401; the @Public route stays open', async () => {
    const { call } = await build();
    expect((await call('GET', '/projects', 'org-a', true)).status).toBe(401);
    expect((await call('GET', '/projects/ping', undefined, true)).status).toBe(200);
  });

  it('the tenant is already known when the per-request transaction begins', async () => {
    const { call, log } = await build();
    await call('POST', '/projects', 'org-a');
    expect(log).toEqual(['begin tenant=org-a']);
  });

  it('a refused write leaves nothing behind', async () => {
    const { call, db } = await build();
    await call('POST', '/projects', 'org-b'); // 403 from the guard
    expect(db.list('org-b')).toEqual([]);
  });
});
