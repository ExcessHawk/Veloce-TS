/**
 * Redis cache store implementation
 * Requires 'redis' or 'ioredis' package to be installed
 * Suitable for distributed applications
 */

import type { CacheStore } from './types';

export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: any): Promise<any>;
  del(...keys: string[]): Promise<number>;
  exists(key: string): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  flushall(): Promise<string>;
  setex(key: string, seconds: number, value: string): Promise<string>;
  expire(key: string, seconds: number): Promise<number>;
  /** SCAN — supported by ioredis (positional args) and node-redis v4 (options object) */
  scan?(...args: any[]): Promise<any>;
}

export class RedisCacheStore implements CacheStore {
  private client: RedisClient;
  private prefix: string;

  constructor(client: RedisClient, options: {
    /**
     * Key prefix for namespacing (default: 'cache:')
     */
    prefix?: string;
  } = {}) {
    this.client = client;
    this.prefix = options.prefix || 'cache:';
  }

  async get<T = any>(key: string): Promise<T | null> {
    const fullKey = this.getFullKey(key);
    const value = await this.client.get(fullKey);
    
    if (!value) {
      return null;
    }

    try {
      return JSON.parse(value) as T;
    } catch {
      return value as any;
    }
  }

  async set<T = any>(key: string, value: T, ttl: number = 0): Promise<void> {
    const fullKey = this.getFullKey(key);
    const serialized = JSON.stringify(value);

    if (ttl > 0) {
      await this.client.setex(fullKey, ttl, serialized);
    } else {
      await this.client.set(fullKey, serialized);
    }
  }

  async delete(key: string): Promise<boolean> {
    const fullKey = this.getFullKey(key);
    const result = await this.client.del(fullKey);
    return result > 0;
  }

  async has(key: string): Promise<boolean> {
    const fullKey = this.getFullKey(key);
    const result = await this.client.exists(fullKey);
    return result > 0;
  }

  async clear(): Promise<void> {
    // Clear only keys with our prefix
    const keys = await this.keys('*');
    await this.deleteFullKeys(keys.map(key => this.getFullKey(key)));
  }

  async deletePattern(pattern: string): Promise<number> {
    const keys = await this.keys(pattern);

    if (keys.length === 0) {
      return 0;
    }

    await this.deleteFullKeys(keys.map(key => this.getFullKey(key)));
    return keys.length;
  }

  async keys(pattern: string = '*'): Promise<string[]> {
    const fullPattern = this.getFullKey(pattern);
    const fullKeys = await this.scanKeys(fullPattern);

    // Remove prefix from keys
    return fullKeys.map(key => key.substring(this.prefix.length));
  }

  /**
   * Enumerate keys with cursor-based SCAN (non-blocking, unlike KEYS which
   * stalls the Redis event loop on large keyspaces). Falls back to KEYS only
   * when the client does not expose scan().
   */
  private async scanKeys(pattern: string): Promise<string[]> {
    if (typeof this.client.scan !== 'function') {
      return this.client.keys(pattern);
    }

    const found: string[] = [];
    let cursor: string | number = '0';

    do {
      const reply: any = await (this.client.scan as any)(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        500
      );

      if (Array.isArray(reply)) {
        // ioredis shape: [cursor, keys]
        cursor = reply[0];
        found.push(...reply[1]);
      } else {
        // node-redis v4 shape: { cursor, keys }
        cursor = reply.cursor;
        found.push(...reply.keys);
      }
    } while (String(cursor) !== '0');

    return found;
  }

  /** Delete keys in batches with variadic DEL instead of one round-trip per key */
  private async deleteFullKeys(fullKeys: string[]): Promise<void> {
    const BATCH = 500;
    for (let i = 0; i < fullKeys.length; i += BATCH) {
      const chunk = fullKeys.slice(i, i + BATCH);
      if (chunk.length > 0) {
        await this.client.del(...chunk);
      }
    }
  }

  private getFullKey(key: string): string {
    return `${this.prefix}${key}`;
  }
}

/**
 * Create Redis cache store from connection string
 * 
 * @example
 * ```typescript
 * // Using redis package
 * import { createClient } from 'redis';
 * const client = createClient({ url: 'redis://localhost:6379' });
 * await client.connect();
 * const store = createRedisCacheStore(client);
 * 
 * // Using ioredis package
 * import Redis from 'ioredis';
 * const client = new Redis('redis://localhost:6379');
 * const store = createRedisCacheStore(client);
 * ```
 */
export function createRedisCacheStore(
  client: RedisClient,
  options?: { prefix?: string }
): RedisCacheStore {
  return new RedisCacheStore(client, options);
}

