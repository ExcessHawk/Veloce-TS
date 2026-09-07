/**
 * The Redis-backed stores, against an in-memory client double.
 *
 * These had ~4% coverage: code whose entire purpose is to behave correctly
 * across replicas was never exercised. `RedisTokenBlacklist.claim()` matters
 * most — it is what stops two concurrent refreshes from both minting a valid
 * token pair.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { FakeRedis, fakeRedisWithoutScan } from './helpers/fake-redis';
import { RedisTokenBlacklist, MemoryTokenBlacklist } from '../src/auth/token-blacklist';
import { RedisRateLimitStore, MemoryRateLimitStore } from '../src/middleware/rate-limit';
import { RedisCacheStore } from '../src/cache/redis-store';
import { RedisSessionStore } from '../src/auth/session';

const inOneHour = () => Math.floor(Date.now() / 1000) + 3600;

// ─── Token blacklist ─────────────────────────────────────────────────────────

describe('RedisTokenBlacklist', () => {
  let redis: FakeRedis;
  let blacklist: RedisTokenBlacklist;

  beforeEach(() => {
    redis = new FakeRedis();
    blacklist = new RedisTokenBlacklist(redis);
  });

  it('add() stores the id under a TTL derived from the token expiry', async () => {
    await blacklist.add('jti-1', inOneHour());
    expect(await blacklist.has('jti-1')).toBe(true);
    expect(redis.liveKeys()).toEqual(['jwt:blacklist:jti-1']);
  });

  it('add() ignores an already-expired token instead of writing a dead key', async () => {
    await blacklist.add('jti-old', Math.floor(Date.now() / 1000) - 60);
    expect(redis.liveKeys()).toHaveLength(0);
    expect(await blacklist.has('jti-old')).toBe(false);
  });

  it('has() is false for an unknown id', async () => {
    expect(await blacklist.has('never-seen')).toBe(false);
  });

  it('claim() succeeds once and fails for every later caller', async () => {
    expect(await blacklist.claim('jti-2', inOneHour())).toBe(true);
    expect(await blacklist.claim('jti-2', inOneHour())).toBe(false);
  });

  it('claim() is atomic under concurrency — exactly one winner', async () => {
    const attempts = await Promise.all(
      Array.from({ length: 8 }, () => blacklist.claim('jti-race', inOneHour()))
    );
    expect(attempts.filter(Boolean)).toHaveLength(1);
  });

  it('claim() uses SET ... NX rather than a read-then-write pair', async () => {
    await blacklist.claim('jti-3', inOneHour());
    const setCall = redis.calls.find((c) => c.command === 'set');
    expect(setCall).toBeDefined();
    expect(setCall!.args.map(String).map((a) => a.toUpperCase())).toContain('NX');
    // A GET before the SET would be exactly the race this is meant to close.
    expect(redis.countCalls('get')).toBe(0);
  });

  it('claim() refuses an already-expired token', async () => {
    expect(await blacklist.claim('jti-4', Math.floor(Date.now() / 1000) - 1)).toBe(false);
  });

  it('cleanup() is a no-op — Redis expires entries itself', async () => {
    await blacklist.add('jti-5', inOneHour());
    await blacklist.cleanup();
    expect(await blacklist.has('jti-5')).toBe(true);
  });

  it('honours a custom key prefix', async () => {
    const prefixed = new RedisTokenBlacklist(redis, 'revoked:');
    await prefixed.add('jti-6', inOneHour());
    expect(redis.liveKeys()).toEqual(['revoked:jti-6']);
  });
});

describe('MemoryTokenBlacklist.claim()', () => {
  it('grants the id to exactly one caller', () => {
    const blacklist = new MemoryTokenBlacklist();
    expect(blacklist.claim('a', inOneHour())).toBe(true);
    expect(blacklist.claim('a', inOneHour())).toBe(false);
  });

  it('lets an expired id be claimed again', () => {
    const blacklist = new MemoryTokenBlacklist();
    blacklist.add('b', Math.floor(Date.now() / 1000) - 10);
    expect(blacklist.claim('b', inOneHour())).toBe(true);
  });
});

// ─── Rate limit ──────────────────────────────────────────────────────────────

describe('RedisRateLimitStore', () => {
  let redis: FakeRedis;
  let store: RedisRateLimitStore;

  beforeEach(() => {
    redis = new FakeRedis();
    store = new RedisRateLimitStore(redis);
  });

  it('counts hits per key', async () => {
    expect((await store.hit('ip-1', 60_000)).count).toBe(1);
    expect((await store.hit('ip-1', 60_000)).count).toBe(2);
    expect((await store.hit('ip-2', 60_000)).count).toBe(1);
  });

  it('sets the window expiry only on the first hit', async () => {
    await store.hit('ip-3', 60_000);
    await store.hit('ip-3', 60_000);
    // A second pexpire would slide the window forward on every request, so the
    // limit would never actually reset.
    expect(redis.countCalls('pexpire')).toBe(1);
  });

  it('reports a resetTime inside the window', async () => {
    const { resetTime } = await store.hit('ip-4', 60_000);
    expect(resetTime).toBeGreaterThan(Date.now());
    expect(resetTime).toBeLessThanOrEqual(Date.now() + 60_000);
  });

  it('reset() clears the counter', async () => {
    await store.hit('ip-5', 60_000);
    await store.reset('ip-5');
    expect((await store.hit('ip-5', 60_000)).count).toBe(1);
  });
});

describe('MemoryRateLimitStore', () => {
  it('starts a fresh window once the previous one elapsed', async () => {
    const store = new MemoryRateLimitStore(0); // no cleanup timer
    expect((await store.hit('k', 20)).count).toBe(1);
    expect((await store.hit('k', 20)).count).toBe(2);
    await new Promise((r) => setTimeout(r, 40));
    expect((await store.hit('k', 20)).count).toBe(1);
    store.destroy();
  });

  it('keeps counters separate per key', async () => {
    const store = new MemoryRateLimitStore(0);
    await store.hit('a', 1000);
    await store.hit('a', 1000);
    expect((await store.hit('b', 1000)).count).toBe(1);
    store.destroy();
  });
});

// ─── Cache store ─────────────────────────────────────────────────────────────

describe('RedisCacheStore', () => {
  let redis: FakeRedis;
  let cache: RedisCacheStore;

  beforeEach(() => {
    redis = new FakeRedis();
    cache = new RedisCacheStore(redis as any);
  });

  it('round-trips a value', async () => {
    await cache.set('user:1', { id: 1, name: 'Ada' });
    expect(await cache.get('user:1')).toEqual({ id: 1, name: 'Ada' });
  });

  it('returns null for a missing key', async () => {
    expect(await cache.get('nope')).toBeNull();
  });

  it('delete() removes the entry', async () => {
    await cache.set('gone', 1);
    await cache.delete('gone');
    expect(await cache.get('gone')).toBeNull();
  });

  it('has() reflects presence', async () => {
    await cache.set('here', 1);
    expect(await cache.has('here')).toBe(true);
    expect(await cache.has('elsewhere')).toBe(false);
  });

  it('deletePattern() walks the cursor across several pages', async () => {
    for (let i = 0; i < 5; i++) await cache.set(`post:${i}`, i);
    await cache.set('user:1', 'keep');

    const deleted = await cache.deletePattern('post:*');
    expect(deleted).toBe(5);
    expect(await cache.get('user:1')).toBe('keep');
    // Five keys at two per page means the loop really did iterate.
    expect(redis.countCalls('scan')).toBeGreaterThan(1);
  });

  it('clear() empties everything under the prefix', async () => {
    for (let i = 0; i < 3; i++) await cache.set(`k${i}`, i);
    await cache.clear();
    expect(await cache.keys()).toHaveLength(0);
  });

  it('falls back to KEYS when the client has no scan()', async () => {
    const legacy = fakeRedisWithoutScan();
    const legacyCache = new RedisCacheStore(legacy as any);
    await legacyCache.set('a', 1);
    await legacyCache.set('b', 2);

    expect(await legacyCache.keys()).toHaveLength(2);
    expect(legacy.countCalls('keys')).toBeGreaterThan(0);
  });
});

// ─── Session store ───────────────────────────────────────────────────────────

describe('RedisSessionStore', () => {
  let redis: FakeRedis;
  let store: RedisSessionStore;

  const makeSession = (id: string, userId = 'u1') => ({
    id,
    userId,
    data: { theme: 'dark' },
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: new Date(Date.now() + 3_600_000),
  });

  beforeEach(() => {
    redis = new FakeRedis();
    store = new RedisSessionStore(redis);
  });

  it('round-trips a session, rehydrating the dates', async () => {
    await store.set('s1', makeSession('s1'));
    const loaded = await store.get('s1');

    expect(loaded).not.toBeNull();
    expect(loaded!.userId).toBe('u1');
    // JSON has no Date type — these must come back as Dates, not strings.
    expect(loaded!.createdAt).toBeInstanceOf(Date);
    expect(loaded!.expiresAt).toBeInstanceOf(Date);
  });

  it('returns null for an unknown session', async () => {
    expect(await store.get('missing')).toBeNull();
  });

  it('returns null rather than throwing on corrupt JSON', async () => {
    await redis.set('sess:broken', '{not json');
    expect(await store.get('broken')).toBeNull();
  });

  it('destroy() removes the session', async () => {
    await store.set('s2', makeSession('s2'));
    await store.destroy('s2');
    expect(await store.get('s2')).toBeNull();
  });

  it('touch() refreshes updatedAt', async () => {
    const session = makeSession('s3');
    session.updatedAt = new Date(Date.now() - 60_000);
    await store.set('s3', session);

    await store.touch('s3');

    const loaded = await store.get('s3');
    expect(loaded!.updatedAt.getTime()).toBeGreaterThan(session.updatedAt.getTime());
  });

  it('length() and all() page through the cursor', async () => {
    for (let i = 0; i < 5; i++) await store.set(`s${i}`, makeSession(`s${i}`));
    expect(await store.length()).toBe(5);
    expect(await store.all()).toHaveLength(5);
  });

  it('clear() drops every session', async () => {
    for (let i = 0; i < 3; i++) await store.set(`s${i}`, makeSession(`s${i}`));
    await store.clear();
    expect(await store.length()).toBe(0);
  });

  it('skips a session whose stored JSON is corrupt in all()', async () => {
    await store.set('good', makeSession('good'));
    await redis.set('sess:bad', 'not-json');
    const sessions = await store.all();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe('good');
  });
});
