import 'reflect-metadata';
import { describe, it, expect, beforeAll } from 'bun:test';
import { Veloce } from 'veloce-ts';
import { HealthCheckPlugin, HealthCheckers } from 'veloce-ts/plugins';

// ── Shared app — no custom checks ────────────────────────────────────────────
let hono: any;

beforeAll(async () => {
  const app = new Veloce({ docs: false });
  app.usePlugin(new HealthCheckPlugin());
  await app.compile();
  hono = app.getHono();
});

// ── Construction ─────────────────────────────────────────────────────────────
describe('HealthCheckPlugin construction', () => {
  it('constructs without options', () => {
    expect(() => new HealthCheckPlugin()).not.toThrow();
  });

  it('has correct name and version', () => {
    const p = new HealthCheckPlugin();
    expect(p.name).toBe('health');
    expect(p.version).toBe('1.0.0');
  });

  it('accepts custom paths', async () => {
    const app = new Veloce({ docs: false });
    app.usePlugin(new HealthCheckPlugin({ path: '/ping', readyPath: '/rdy', livePath: '/lv' }));
    await app.compile();
    const h = app.getHono();
    expect((await h.fetch(new Request('http://localhost/ping'))).status).toBe(200);
    expect((await h.fetch(new Request('http://localhost/rdy'))).status).toBe(200);
    expect((await h.fetch(new Request('http://localhost/lv'))).status).toBe(200);
  });

  it('installs without throwing', async () => {
    const app = new Veloce({ docs: false });
    app.usePlugin(new HealthCheckPlugin());
    await expect(app.compile()).resolves.toBeUndefined();
  });
});

// ── /live endpoint ────────────────────────────────────────────────────────────
describe('HealthCheckPlugin /live', () => {
  it('GET /live → 200', async () => {
    const res = await hono.fetch(new Request('http://localhost/live'));
    expect(res.status).toBe(200);
  });

  it('body.status is "alive"', async () => {
    const res = await hono.fetch(new Request('http://localhost/live'));
    const body = await res.json();
    expect(body.status).toBe('alive');
  });

  it('body has ISO timestamp', async () => {
    const res = await hono.fetch(new Request('http://localhost/live'));
    const body = await res.json();
    expect(typeof body.timestamp).toBe('string');
    expect(() => new Date(body.timestamp)).not.toThrow();
  });

  it('body has numeric uptime >= 0', async () => {
    const res = await hono.fetch(new Request('http://localhost/live'));
    const body = await res.json();
    expect(typeof body.uptime).toBe('number');
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });
});

// ── /health — no custom checks ────────────────────────────────────────────────
describe('HealthCheckPlugin /health — no checks', () => {
  it('GET /health → 200', async () => {
    const res = await hono.fetch(new Request('http://localhost/health'));
    expect(res.status).toBe(200);
  });

  it('body.status is "healthy"', async () => {
    const res = await hono.fetch(new Request('http://localhost/health'));
    const body = await res.json();
    expect(body.status).toBe('healthy');
  });

  it('body has timestamp and uptime', async () => {
    const res = await hono.fetch(new Request('http://localhost/health'));
    const body = await res.json();
    expect(typeof body.timestamp).toBe('string');
    expect(typeof body.uptime).toBe('number');
  });

  it('no checks key when no checks configured', async () => {
    const res = await hono.fetch(new Request('http://localhost/health'));
    const body = await res.json();
    expect(body.checks).toBeUndefined();
  });
});

// ── /health — with custom checks ─────────────────────────────────────────────
describe('HealthCheckPlugin /health — with checks', () => {
  it('all checks healthy → 200 and status healthy', async () => {
    const checker = () => ({ status: 'healthy' as const, message: 'OK' });
    Object.defineProperty(checker, 'name', { value: 'myCheck', configurable: true });
    const app = new Veloce({ docs: false });
    app.usePlugin(new HealthCheckPlugin({ checks: [checker] }));
    await app.compile();
    const h = app.getHono();
    const res = await h.fetch(new Request('http://localhost/health'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('healthy');
  });

  it('one unhealthy check → 503 and status unhealthy', async () => {
    const checker = () => ({ status: 'unhealthy' as const, message: 'broken' });
    Object.defineProperty(checker, 'name', { value: 'broken', configurable: true });
    const app = new Veloce({ docs: false });
    app.usePlugin(new HealthCheckPlugin({ checks: [checker] }));
    await app.compile();
    const h = app.getHono();
    const res = await h.fetch(new Request('http://localhost/health'));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('unhealthy');
  });

  it('check that throws → 503', async () => {
    const checker = () => { throw new Error('kaboom'); };
    Object.defineProperty(checker, 'name', { value: 'throws', configurable: true });
    const app = new Veloce({ docs: false });
    app.usePlugin(new HealthCheckPlugin({ checks: [checker as any] }));
    await app.compile();
    const h = app.getHono();
    const res = await h.fetch(new Request('http://localhost/health'));
    expect(res.status).toBe(503);
  });

  it('checks key present in response when checks configured', async () => {
    const checker = () => ({ status: 'healthy' as const });
    Object.defineProperty(checker, 'name', { value: 'someCheck', configurable: true });
    const app = new Veloce({ docs: false });
    app.usePlugin(new HealthCheckPlugin({ checks: [checker] }));
    await app.compile();
    const h = app.getHono();
    const res = await h.fetch(new Request('http://localhost/health'));
    const body = await res.json();
    expect(body.checks).toBeDefined();
  });
});

// ── /ready endpoint ───────────────────────────────────────────────────────────
describe('HealthCheckPlugin /ready', () => {
  it('no critical checks → 200, status "ready"', async () => {
    const res = await hono.fetch(new Request('http://localhost/ready'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ready');
  });

  it('database check healthy → 200', async () => {
    const dbCheck = HealthCheckers.database(async () => true);
    const app = new Veloce({ docs: false });
    app.usePlugin(new HealthCheckPlugin({ checks: [dbCheck] }));
    await app.compile();
    const h = app.getHono();
    const res = await h.fetch(new Request('http://localhost/ready'));
    expect(res.status).toBe(200);
  });

  it('database check unhealthy → 503', async () => {
    const dbCheck = HealthCheckers.database(async () => false);
    const app = new Veloce({ docs: false });
    app.usePlugin(new HealthCheckPlugin({ checks: [dbCheck] }));
    await app.compile();
    const h = app.getHono();
    const res = await h.fetch(new Request('http://localhost/ready'));
    expect(res.status).toBe(503);
  });
});

// ── HealthCheckers factory ────────────────────────────────────────────────────
describe('HealthCheckers factory', () => {
  it('alwaysHealthy() returns healthy result', () => {
    const result = HealthCheckers.alwaysHealthy();
    expect(result.status).toBe('healthy');
  });

  it('database() with passing pingFn → healthy', async () => {
    const checker = HealthCheckers.database(async () => true);
    const result = await checker();
    expect(result.status).toBe('healthy');
  });

  it('database() with failing pingFn → unhealthy', async () => {
    const checker = HealthCheckers.database(async () => false);
    const result = await checker();
    expect(result.status).toBe('unhealthy');
  });

  it('database() with throwing pingFn → unhealthy', async () => {
    const checker = HealthCheckers.database(async () => { throw new Error('conn refused'); });
    const result = await checker();
    expect(result.status).toBe('unhealthy');
  });

  it('memory() checker runs without error', async () => {
    const checker = HealthCheckers.memory(4096); // 4GB threshold — always healthy
    const result = await Promise.resolve(checker());
    expect(['healthy', 'unhealthy']).toContain(result.status);
  });

  it('database checker has name "database"', () => {
    const checker = HealthCheckers.database(() => true);
    const name = (checker as any).name || (checker as any).__veloceCheckerName;
    expect(name).toBe('database');
  });
});
