/**
 * Redis cache store implementation
 * Requires 'redis' or 'ioredis' package to be installed
 * Suitable for distributed applications
 */

import type { CacheStore } from './types';

export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: any): Promise<any>;
  del(key: string): Promise<number>;
  exists(key: string): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  flushall(): Promise<string>;
  setex(key: string, seconds: number, value: string): Promise<string>;
  expire(key: string, seconds: number): Promise<number>;
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
    if (keys.length > 0) {
      await Promise.all(keys.map(key => this.delete(key)));
    }
  }

  async deletePattern(pattern: string): Promise<number> {
    const keys = await this.keys(pattern);
    
    if (keys.length === 0) {
      return 0;
    }

    await Promise.all(keys.map(key => this.delete(key)));
    return keys.length;
  }

  async keys(pattern: string = '*'): Promise<string[]> {
    const fullPattern = this.getFullKey(pattern);
    const fullKeys = await this.client.keys(fullPattern);
    
    // Remove prefix from keys
    return fullKeys.map(key => key.substring(this.prefix.length));
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

