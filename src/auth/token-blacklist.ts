/**
 * Pluggable token blacklist for JWT revocation.
 *
 * MemoryTokenBlacklist is the default (single-instance deployments).
 * RedisTokenBlacklist propagates revocation across instances — pass any
 * ioredis-compatible client, entries expire automatically via SETEX.
 *
 * Entries are keyed by the token's `jti` (every token minted by JWTProvider
 * carries one) rather than the raw JWT: the key stays short and the store
 * never holds a replayable credential.
 */
export interface TokenBlacklist {
  /** Blacklist a token id until its expiry (unix seconds) */
  add(tokenId: string, expUnixSeconds: number): void | Promise<void>;
  /** Whether the token id is currently blacklisted */
  has(tokenId: string): boolean | Promise<boolean>;
  /** Remove expired entries (no-op for stores with native TTL) */
  cleanup(): void | Promise<void>;
  /**
   * Blacklist `tokenId` only if it is not blacklisted yet, returning whether
   * this call was the one that claimed it. Used to make refresh-token rotation
   * atomic: two concurrent refreshes with the same token both verify, but only
   * the winner gets `true` and may mint a new pair.
   *
   * Optional — stores that don't implement it fall back to a
   * (non-atomic) has/add pair.
   */
  claim?(tokenId: string, expUnixSeconds: number): boolean | Promise<boolean>;
}

export class MemoryTokenBlacklist implements TokenBlacklist {
  // Map<jti, exp_unix_seconds> — O(1) lookup, lazy expiry cleanup
  private tokens: Map<string, number> = new Map();

  add(tokenId: string, expUnixSeconds: number): void {
    this.tokens.set(tokenId, expUnixSeconds);
  }

  has(tokenId: string): boolean {
    const exp = this.tokens.get(tokenId);
    if (exp === undefined) return false;
    if (exp < Math.floor(Date.now() / 1000)) {
      this.tokens.delete(tokenId);
      return false;
    }
    return true;
  }

  /**
   * Atomic in this runtime: JS is single-threaded, so the check and the write
   * cannot interleave with another caller.
   */
  claim(tokenId: string, expUnixSeconds: number): boolean {
    if (this.has(tokenId)) return false;
    this.add(tokenId, expUnixSeconds);
    return true;
  }

  cleanup(): void {
    const now = Math.floor(Date.now() / 1000);
    for (const [tokenId, exp] of this.tokens) {
      if (exp < now) this.tokens.delete(tokenId);
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

  async add(tokenId: string, expUnixSeconds: number): Promise<void> {
    const ttl = expUnixSeconds - Math.floor(Date.now() / 1000);
    if (ttl <= 0) return; // already expired, nothing to revoke
    await this.redis.setex(this.prefix + tokenId, ttl, '1');
  }

  async has(tokenId: string): Promise<boolean> {
    const result = await this.redis.exists(this.prefix + tokenId);
    return result === 1;
  }

  /**
   * `SET key 1 NX EX ttl` — a single round trip that succeeds for exactly one
   * caller, so concurrent refreshes of the same token cannot both win.
   */
  async claim(tokenId: string, expUnixSeconds: number): Promise<boolean> {
    const ttl = expUnixSeconds - Math.floor(Date.now() / 1000);
    if (ttl <= 0) return false; // already expired — nothing to claim
    const result = await this.redis.set(this.prefix + tokenId, '1', 'EX', ttl, 'NX');
    return result === 'OK' || result === true;
  }

  async cleanup(): Promise<void> {
    // Redis expires entries natively via SETEX TTL
  }
}
