/**
 * Cache tests — MemoryCacheStore and CacheManager
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { MemoryCacheStore } from '../src/cache/memory-store';
import { CacheManager, getCache, setCache, deleteCache, invalidateCache, clearCache } from '../src/cache/manager';
import { parseTTL } from '../src/cache/types';

// ─── parseTTL ─────────────────────────────────────────────────────────────────

describe('parseTTL', () => {
  it('number is returned as-is', () => {
    expect(parseTTL(60)).toBe(60);
  });

  it('string "60s" parses to 60', () => {
    expect(parseTTL('60s')).toBe(60);
  });

  it('string "2m" parses to 120', () => {
    expect(parseTTL('2m')).toBe(120);
  });

  it('string "1h" parses to 3600', () => {
    expect(parseTTL('1h')).toBe(3600);
  });

  it('string "1d" parses to 86400', () => {
    expect(parseTTL('1d')).toBe(86400);
  });
});

// ─── MemoryCacheStore ─────────────────────────────────────────────────────────

describe('MemoryCacheStore – basic operations', () => {
  let store: MemoryCacheStore;

  beforeEach(() => {
    store = new MemoryCacheStore({ cleanupInterval: 0 });
  });

  it('get returns null for missing key', async () => {
    expect(await store.get('missing')).toBeNull();
  });

  it('set then get returns the value', async () => {
    await store.set('key1', { foo: 'bar' });
    expect(await store.get('key1')).toEqual({ foo: 'bar' });
  });

  it('has returns true for existing key', async () => {
    await store.set('key2', 42);
    expect(await store.has('key2')).toBe(true);
  });

  it('has returns false for missing key', async () => {
    expect(await store.has('nope')).toBe(false);
  });

  it('delete removes key and returns true', async () => {
    await store.set('key3', 'value');
    const deleted = await store.delete('key3');
    expect(deleted).toBe(true);
    expect(await store.get('key3')).toBeNull();
  });

  it('delete returns false for non-existent key', async () => {
    expect(await store.delete('ghost')).toBe(false);
  });

  it('clear removes all keys', async () => {
    await store.set('a', 1);
    await store.set('b', 2);
    await store.clear();
    expect(await store.get('a')).toBeNull();
    expect(await store.get('b')).toBeNull();
  });

  it('keys returns all stored keys', async () => {
    await store.set('x', 1);
    await store.set('y', 2);
    const keys = await store.keys();
    expect(keys).toContain('x');
    expect(keys).toContain('y');
  });

  it('getStats reflects current size', async () => {
    await store.set('s1', 1);
    await store.set('s2', 2);
    const stats = store.getStats();
    expect(stats.size).toBeGreaterThanOrEqual(2);
  });
});

describe('MemoryCacheStore – TTL expiry', () => {
  it('returns null after TTL expires', async () => {
    const store = new MemoryCacheStore({ cleanupInterval: 0 });
    await store.set('ttl-key', 'hello', 1); // 1 second
    await new Promise(r => setTimeout(r, 1100));
    expect(await store.get('ttl-key')).toBeNull();
  });

  it('has returns false after TTL expires', async () => {
    const store = new MemoryCacheStore({ cleanupInterval: 0 });
    await store.set('ttl-has', 'world', 1);
    await new Promise(r => setTimeout(r, 1100));
    expect(await store.has('ttl-has')).toBe(false);
  });

  it('key without TTL (0) does not expire', async () => {
    const store = new MemoryCacheStore({ cleanupInterval: 0 });
    await store.set('no-ttl', 'persistent', 0);
    await new Promise(r => setTimeout(r, 100));
    expect(await store.get('no-ttl')).toBe('persistent');
  });
});

describe('MemoryCacheStore – pattern deletion', () => {
  let store: MemoryCacheStore;

  beforeEach(async () => {
    store = new MemoryCacheStore({ cleanupInterval: 0 });
    await store.set('user:1', 'alice');
    await store.set('user:2', 'bob');
    await store.set('product:1', 'widget');
  });

  it('deletePattern removes matching keys', async () => {
    const count = await store.deletePattern('user:*');
    expect(count).toBe(2);
    expect(await store.get('user:1')).toBeNull();
    expect(await store.get('user:2')).toBeNull();
  });

  it('deletePattern leaves non-matching keys intact', async () => {
    await store.deletePattern('user:*');
    expect(await store.get('product:1')).toBe('widget');
  });

  it('keys with pattern filters results', async () => {
    const keys = await store.keys('user:*');
    expect(keys).toContain('user:1');
    expect(keys).toContain('user:2');
    expect(keys).not.toContain('product:1');
  });

  it('deletePattern returns 0 when no key matches', async () => {
    const count = await store.deletePattern('order:*');
    expect(count).toBe(0);
  });
});

describe('MemoryCacheStore – max size eviction', () => {
  it('evicts oldest entry when maxSize is exceeded', async () => {
    const store = new MemoryCacheStore({ maxSize: 2, cleanupInterval: 0 });
    await store.set('oldest', 1);
    await store.set('middle', 2);
    await store.set('newest', 3); // triggers eviction
    // 'oldest' should be gone (LRU eviction)
    const stats = store.getStats();
    expect(stats.size).toBeLessThanOrEqual(2);
  });
});

// ─── CacheManager ─────────────────────────────────────────────────────────────

describe('CacheManager', () => {
  beforeEach(() => {
    CacheManager.reset();
  });

  it('set then get returns value from default store', async () => {
    await CacheManager.set('mgr:key', { hello: 'world' });
    const val = await CacheManager.get('mgr:key');
    expect(val).toEqual({ hello: 'world' });
  });

  it('delete removes key', async () => {
    await CacheManager.set('mgr:del', 'bye');
    await CacheManager.delete('mgr:del');
    expect(await CacheManager.get('mgr:del')).toBeNull();
  });

  it('invalidate removes keys matching pattern', async () => {
    await CacheManager.set('ns:a', 1);
    await CacheManager.set('ns:b', 2);
    await CacheManager.set('other:c', 3);
    await CacheManager.invalidate('ns:*');
    expect(await CacheManager.get('ns:a')).toBeNull();
    expect(await CacheManager.get('ns:b')).toBeNull();
    expect(await CacheManager.get('other:c')).toBe(3);
  });

  it('clear removes all keys from default store', async () => {
    await CacheManager.set('clear:x', 1);
    await CacheManager.set('clear:y', 2);
    await CacheManager.clear();
    expect(await CacheManager.get('clear:x')).toBeNull();
  });

  it('reset replaces default store entirely', async () => {
    await CacheManager.set('before:reset', 'present');
    CacheManager.reset();
    expect(await CacheManager.get('before:reset')).toBeNull();
  });

  it('registerStore and getStore round-trip', () => {
    const custom = new MemoryCacheStore({ cleanupInterval: 0 });
    CacheManager.registerStore('custom', custom);
    expect(CacheManager.getStore('custom')).toBe(custom);
  });

  it('getStore returns undefined for unregistered name', () => {
    expect(CacheManager.getStore('nonexistent')).toBeUndefined();
  });

  it('set/get with string TTL (parseTTL path)', async () => {
    await CacheManager.set('ttl-str', 'value', '1h');
    expect(await CacheManager.get('ttl-str')).toBe('value');
  });

  it('set/get with named store', async () => {
    const named = new MemoryCacheStore({ cleanupInterval: 0 });
    CacheManager.registerStore('named', named);
    await CacheManager.set('named:key', 'hi', 0, named);
    expect(await CacheManager.get('named:key', named)).toBe('hi');
    // Should NOT be in default store
    expect(await CacheManager.get('named:key')).toBeNull();
  });
});

describe('CacheManager – generateKey', () => {
  it('generates key from method and path', () => {
    const key = CacheManager.generateKey('GET', '/users');
    expect(key).toBeTruthy();
    expect(key).toContain('get');
  });

  it('custom key with prefix', () => {
    const key = CacheManager.generateKey('GET', '/users', undefined, undefined, {
      prefix: 'myapp',
      key: 'users-list',
    });
    expect(key).toBe('myapp:users-list');
  });

  it('custom key with param replacement', () => {
    const key = CacheManager.generateKey('GET', '/users/1', { id: '42' }, undefined, {
      key: 'user:{id}',
    });
    expect(key).toBe('user:42');
  });

  it('includes query when includeQuery is true', () => {
    const key = CacheManager.generateKey('GET', '/search', undefined, { q: 'hello' }, {
      includeQuery: true,
    });
    expect(key).toContain('hello');
  });

  it('different query params produce different keys', () => {
    const k1 = CacheManager.generateKey('GET', '/search', undefined, { q: 'a' }, { includeQuery: true });
    const k2 = CacheManager.generateKey('GET', '/search', undefined, { q: 'b' }, { includeQuery: true });
    expect(k1).not.toBe(k2);
  });
});

// ─── Convenience functions ────────────────────────────────────────────────────

describe('cache convenience functions', () => {
  beforeEach(() => {
    CacheManager.reset();
  });

  it('setCache and getCache round-trip', async () => {
    await setCache('fn:key', 'fn-value');
    expect(await getCache('fn:key')).toBe('fn-value');
  });

  it('deleteCache removes key', async () => {
    await setCache('fn:del', 'bye');
    await deleteCache('fn:del');
    expect(await getCache('fn:del')).toBeNull();
  });

  it('invalidateCache removes matching keys', async () => {
    await setCache('prefix:1', 1);
    await setCache('prefix:2', 2);
    await invalidateCache('prefix:*');
    expect(await getCache('prefix:1')).toBeNull();
    expect(await getCache('prefix:2')).toBeNull();
  });

  it('clearCache empties entire default store', async () => {
    await setCache('clr:a', 1);
    await clearCache();
    expect(await getCache('clr:a')).toBeNull();
  });
});
