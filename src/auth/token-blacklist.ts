/**
 * Pluggable token blacklist for JWT revocation.
 *
 * MemoryTokenBlacklist is the default (single-instance deployments).
 * RedisTokenBlacklist propagates revocation across instances — pass any
 * ioredis-compatible client, entries expire automatically via SETEX.
 */
export interface TokenBlacklist {
  /** Blacklist a token until its expiry (unix seconds) */
  add(token: string, expUnixSeconds: number): void | Promise<void>;
  /** Whether the token is currently blacklisted */
  has(token: string): boolean | Promise<boolean>;
  /** Remove expired entries (no-op for stores with native TTL) */
  cleanup(): void | Promise<void>;
}

export class MemoryTokenBlacklist implements TokenBlacklist {
  // Map<token, exp_unix_seconds> — O(1) lookup, lazy expiry cleanup
  private tokens: Map<string, number> = new Map();

  add(token: string, expUnixSeconds: number): void {
    this.tokens.set(token, expUnixSeconds);
  }

  has(token: string): boolean {
    const exp = this.tokens.get(token);
    if (exp === undefined) return false;
    if (exp < Math.floor(Date.now() / 1000)) {
      this.tokens.delete(token);
      return false;
    }
    return true;
  }

  cleanup(): void {
    const now = Math.floor(Date.now() / 1000);
    for (const [token, exp] of this.tokens) {
      if (exp < now) this.tokens.delete(token);
    }
  }
}

export class RedisTokenBlacklist implements TokenBlacklist {
  private prefix: string = 'jwt:blacklist:';

  constructor(private redis: any, prefix?: string) {
    if (prefix) {
      this.prefix = prefix;
    }
  }

  async add(token: string, expUnixSeconds: number): Promise<void> {
    const ttl = expUnixSeconds - Math.floor(Date.now() / 1000);
    if (ttl <= 0) return; // already expired, nothing to revoke
    await this.redis.setex(this.prefix + token, ttl, '1');
  }

  async has(token: string): Promise<boolean> {
    const result = await this.redis.exists(this.prefix + token);
    return result === 1;
  }

  async cleanup(): Promise<void> {
    // Redis expires entries natively via SETEX TTL
  }
}
