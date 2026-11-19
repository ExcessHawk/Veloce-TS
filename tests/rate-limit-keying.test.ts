/**
 * Rate limiter keying: by client address resolved from trusted proxy hops, by
 * authenticated user, or both; plus `skip`.
 */
import { describe, it, expect } from 'bun:test';
import 'reflect-metadata';
import { VeloceTS } from '../src/core/application';
import { AuthPlugin } from '../src/auth/auth-plugin';
import { InMemoryUserProvider } from '../src/auth/auth-service';
import { clientIp } from '../src/middleware/client-ip';
import type { RateLimitOptions } from '../src/types';

const SECRET = 'test-secret-key-32chars-minimum!!';

async function build(limit: RateLimitOptions) {
  const userProvider = new InMemoryUserProvider();
  await userProvider.createUser({ username: 'alice', password: 'secret1', roles: ['user'] });
  await userProvider.createUser({ username: 'bob', password: 'secret1', roles: ['user'] });
  const auth = new AuthPlugin({ jwt: { secret: SECRET }, userProvider, enableDefaultRoutes: false });

  const app = new VeloceTS({ docs: false });
  app.usePlugin(auth);
  app.useRateLimit({ windowMs: 60_000, ...limit });
  app.get('/data', { handler: () => ({ ok: true }) });
  app.get('/health', { handler: () => ({ ok: true }) });
  await app.compile();

  const tokenOf = async (name: string) =>
    (await auth.getAuthService().login(name, 'secret1')).tokens.accessToken;

  const hit = async (opts: { token?: string; xff?: string; path?: string } = {}) => {
    const headers: Record<string, string> = {};
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    if (opts.xff) headers['X-Forwarded-For'] = opts.xff;
    return (await app.getHono().request(opts.path ?? '/data', { headers })).status;
  };

  return { hit, alice: await tokenOf('alice'), bob: await tokenOf('bob') };
}

describe('clientIp', () => {
  const ctx = (xff: string | undefined, peer?: string): any => ({
    req: { header: (name: string) => (name.toLowerCase() === 'x-forwarded-for' ? xff : undefined), raw: {} },
    env: peer ? { incoming: { socket: { remoteAddress: peer } } } : {},
  });

  it('ignores X-Forwarded-For when no proxy is trusted', () => {
    expect(clientIp(ctx('6.6.6.6', '10.0.0.1'))).toBe('10.0.0.1');
  });

  it('reads the entry written by the trusted proxy, counted from the right', () => {
    // client claims 6.6.6.6; the load balancer appended the real peer 203.0.113.9
    expect(clientIp(ctx('6.6.6.6, 203.0.113.9', '10.0.0.1'), { trustedProxyHops: 1 })).toBe('203.0.113.9');
    expect(clientIp(ctx('6.6.6.6, 203.0.113.9, 10.0.0.5', '10.0.0.1'), { trustedProxyHops: 2 })).toBe('203.0.113.9');
  });

  it('falls back to the peer when the header is shorter than the declared hops', () => {
    expect(clientIp(ctx('203.0.113.9', '10.0.0.1'), { trustedProxyHops: 3 })).toBe('10.0.0.1');
    expect(clientIp(ctx(undefined, '10.0.0.1'), { trustedProxyHops: 1 })).toBe('10.0.0.1');
  });

  it('returns undefined when nothing identifies the client', () => {
    expect(clientIp(ctx(undefined))).toBeUndefined();
  });

  it('reads the Bun and Deno shapes too', () => {
    const bun: any = { req: { header: () => undefined, raw: {} }, env: { requestIP: () => ({ address: '192.0.2.7' }) } };
    const deno: any = { req: { header: () => undefined, raw: {} }, env: { remoteAddr: { hostname: '192.0.2.8' } } };
    expect(clientIp(bun)).toBe('192.0.2.7');
    expect(clientIp(deno)).toBe('192.0.2.8');
  });
});

describe('rate limit keyBy', () => {
  it("'ip' with trusted hops: a forged leftmost entry does not buy a fresh bucket", async () => {
    const { hit } = await build({ max: 2, trustedProxyHops: 1 });
    // Same real client (rightmost entry), a different forged prefix every time
    expect(await hit({ xff: '1.1.1.1, 203.0.113.9' })).toBe(200);
    expect(await hit({ xff: '2.2.2.2, 203.0.113.9' })).toBe(200);
    expect(await hit({ xff: '3.3.3.3, 203.0.113.9' })).toBe(429);
    // A genuinely different client is unaffected
    expect(await hit({ xff: '3.3.3.3, 198.51.100.4' })).toBe(200);
  });

  it("'ip' without trusted hops: rotating X-Forwarded-For changes nothing", async () => {
    const { hit } = await build({ max: 2 });
    expect(await hit({ xff: '1.1.1.1' })).toBe(200);
    expect(await hit({ xff: '2.2.2.2' })).toBe(200);
    expect(await hit({ xff: '3.3.3.3' })).toBe(429);
  });

  it("'user': each user has its own bucket behind the same address", async () => {
    const { hit, alice, bob } = await build({ max: 2, keyBy: 'user' });
    expect(await hit({ token: alice })).toBe(200);
    expect(await hit({ token: alice })).toBe(200);
    expect(await hit({ token: alice })).toBe(429);
    expect(await hit({ token: bob })).toBe(200);
  });

  it("'user': anonymous requests are not limited by this limiter", async () => {
    const { hit } = await build({ max: 1, keyBy: 'user' });
    expect(await hit()).toBe(200);
    expect(await hit()).toBe(200);
    expect(await hit()).toBe(200);
  });

  it("'user-or-ip': anonymous traffic is limited by address and does not eat a user's quota", async () => {
    const { hit, alice } = await build({ max: 2, keyBy: 'user-or-ip', trustedProxyHops: 1 });
    expect(await hit({ xff: '203.0.113.9' })).toBe(200);
    expect(await hit({ xff: '203.0.113.9' })).toBe(200);
    expect(await hit({ xff: '203.0.113.9' })).toBe(429);
    // Same address, but authenticated: separate bucket
    expect(await hit({ xff: '203.0.113.9', token: alice })).toBe(200);
  });

  it('skip exempts matching requests', async () => {
    const { hit } = await build({ max: 1, skip: (c) => c.req.path === '/health' });
    expect(await hit({ path: '/health' })).toBe(200);
    expect(await hit({ path: '/health' })).toBe(200);
    expect(await hit({ path: '/data' })).toBe(200);
    expect(await hit({ path: '/data' })).toBe(429);
  });

  it('a custom keyGenerator still wins over keyBy', async () => {
    const { hit } = await build({ max: 1, keyBy: 'user', keyGenerator: () => 'everyone' });
    expect(await hit()).toBe(200);
    expect(await hit()).toBe(429);
  });
});
