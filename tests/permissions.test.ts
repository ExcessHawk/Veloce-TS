import 'reflect-metadata';
import { describe, it, expect, beforeAll } from 'bun:test';
import { Veloce, AuthPlugin } from 'veloce-ts';
import { PermissionPlugin, PermissionManager } from 'veloce-ts/auth';
import { InMemoryUserProvider } from '../src/auth/auth-service';

const JWT_CONFIG = { secret: 'test-secret-32chars-minimum-abcd', expiresIn: '1h', refreshExpiresIn: '7d' };
const userProvider = new InMemoryUserProvider();

function makeApp(permConfig?: any) {
  const app = new Veloce({ docs: false });
  app.usePlugin(new AuthPlugin({ jwt: JWT_CONFIG, userProvider }));
  app.usePlugin(new PermissionPlugin(permConfig));
  return app;
}

// ── Shared app (management routes enabled) ───────────────────────────────────
let hono: any;

beforeAll(async () => {
  const app = makeApp({ enableManagementRoutes: true });
  await app.compile();
  hono = app.getHono();
});

// ── Construction ─────────────────────────────────────────────────────────────
describe('PermissionPlugin construction', () => {
  it('constructs with no config', () => {
    expect(() => new PermissionPlugin()).not.toThrow();
  });

  it('has correct name and version', () => {
    const p = new PermissionPlugin();
    expect(p.name).toBe('permissions');
    expect(p.version).toBe('1.0.0');
  });

  it('returns PermissionManager from getPermissionManager()', () => {
    const p = new PermissionPlugin();
    expect(p.getPermissionManager()).toBeInstanceOf(PermissionManager);
  });

  it('uses custom permissionManager when provided', () => {
    const pm = new PermissionManager();
    const p = new PermissionPlugin({ permissionManager: pm });
    expect(p.getPermissionManager()).toBe(pm);
  });

  it('installs without throwing', async () => {
    const app = makeApp();
    await expect(app.compile()).resolves.toBeUndefined();
  });
});

// ── PermissionManager unit ───────────────────────────────────────────────────
describe('PermissionManager unit', () => {
  it('grantPermission stores and getUserPermissions retrieves it', () => {
    const pm = new PermissionManager();
    pm.grantPermission({
      userId: 'u1',
      resource: 'post',
      permissions: [{ action: 'read', resource: 'post' }],
      grantedAt: new Date()
    });
    const perms = pm.getUserPermissions('u1', 'post');
    expect(perms.length).toBeGreaterThan(0);
    expect(perms[0].action).toBe('read');
  });

  it('revokePermission removes all permissions for resource', () => {
    const pm = new PermissionManager();
    pm.grantPermission({
      userId: 'u2',
      resource: 'post',
      permissions: [{ action: 'write', resource: 'post' }],
      grantedAt: new Date()
    });
    pm.revokePermission('u2', 'post');
    const perms = pm.getUserPermissions('u2', 'post');
    expect(perms.length).toBe(0);
  });

  it('getUserResources returns resource types user has permissions on', () => {
    const pm = new PermissionManager();
    pm.grantPermission({ userId: 'u3', resource: 'comment', permissions: [{ action: 'delete', resource: 'comment' }], grantedAt: new Date() });
    pm.grantPermission({ userId: 'u3', resource: 'post', permissions: [{ action: 'read', resource: 'post' }], grantedAt: new Date() });
    const resources = pm.getUserResources('u3');
    expect(resources).toContain('comment');
    expect(resources).toContain('post');
  });

  it('getUserPermissions returns empty array for unknown user', () => {
    const pm = new PermissionManager();
    expect(pm.getUserPermissions('nobody', 'post')).toEqual([]);
  });

  it('getUserResources returns empty array for unknown user', () => {
    const pm = new PermissionManager();
    expect(pm.getUserResources('nobody')).toEqual([]);
  });
});

// ── Management routes — unauthenticated → 4xx ────────────────────────────────
describe('PermissionPlugin management routes — unauthenticated', () => {
  it('POST /permissions/grant without auth → 4xx', async () => {
    const res = await hono.fetch(new Request('http://localhost/permissions/grant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'u1', resource: 'post', permissions: [] })
    }));
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('DELETE /permissions/revoke without auth → 4xx', async () => {
    const res = await hono.fetch(new Request('http://localhost/permissions/revoke', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'u1', resource: 'post' })
    }));
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('POST /permissions/check without auth → 4xx', async () => {
    const res = await hono.fetch(new Request('http://localhost/permissions/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'u1', action: 'read', resource: 'post' })
    }));
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('GET /permissions/user/:id/resource/:resource without auth → 4xx', async () => {
    const res = await hono.fetch(new Request('http://localhost/permissions/user/u1/resource/post'));
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('GET /permissions/user/:id/resources without auth → 4xx', async () => {
    const res = await hono.fetch(new Request('http://localhost/permissions/user/u1/resources'));
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

// ── Disabled management routes → 404 ─────────────────────────────────────────
describe('PermissionPlugin — disabled management routes', () => {
  it('enableManagementRoutes: false → /permissions/grant returns 404', async () => {
    const app = makeApp({ enableManagementRoutes: false });
    await app.compile();
    const h = app.getHono();
    const res = await h.fetch(new Request('http://localhost/permissions/grant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    }));
    expect(res.status).toBe(404);
  });
});
