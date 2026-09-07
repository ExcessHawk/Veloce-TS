/**
 * A minimal in-memory stand-in for an ioredis client.
 *
 * The Redis-backed stores (cache, session, token blacklist, rate limit) had
 * essentially no coverage, which is uncomfortable for code whose whole job is to
 * be correct across replicas — `RedisTokenBlacklist.claim()` in particular is
 * what stops two concurrent refreshes from both minting a token pair.
 *
 * Only the commands the framework actually issues are implemented:
 * `get set setex del exists incr pexpire pttl scan keys`.
 */
export class FakeRedis {
  private store = new Map<string, string>();
  /** Absolute expiry in ms, for keys that have one. */
  private expiries = new Map<string, number>();

  /** Every command received, in order — handy for asserting how a store talks. */
  public readonly calls: Array<{ command: string; args: unknown[] }> = [];

  /** Set by tests to make `scan` unavailable, exercising the KEYS fallback. */
  public supportsScan = true;

  constructor(private now: () => number = () => Date.now()) {}

  private record(command: string, ...args: unknown[]): void {
    this.calls.push({ command, args });
  }

  /** Drop the key if its TTL has passed. */
  private evictIfExpired(key: string): void {
    const expiry = this.expiries.get(key);
    if (expiry !== undefined && expiry <= this.now()) {
      this.store.delete(key);
      this.expiries.delete(key);
    }
  }

  async get(key: string): Promise<string | null> {
    this.record('get', key);
    this.evictIfExpired(key);
    return this.store.get(key) ?? null;
  }

  /**
   * Supports the plain form and the `SET key value EX <ttl> NX` form the
   * blacklist uses to claim a token atomically.
   */
  async set(key: string, value: string, ...args: unknown[]): Promise<string | null> {
    this.record('set', key, value, ...args);
    this.evictIfExpired(key);

    const flags = args.map((a) => String(a).toUpperCase());
    if (flags.includes('NX') && this.store.has(key)) {
      return null; // already claimed
    }

    this.store.set(key, value);

    const exIndex = flags.indexOf('EX');
    if (exIndex !== -1) {
      const seconds = Number(args[exIndex + 1]);
      this.expiries.set(key, this.now() + seconds * 1000);
    }

    return 'OK';
  }

  async setex(key: string, seconds: number, value: string): Promise<'OK'> {
    this.record('setex', key, seconds, value);
    this.store.set(key, value);
    this.expiries.set(key, this.now() + seconds * 1000);
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    this.record('del', ...keys);
    let removed = 0;
    for (const key of keys) {
      if (this.store.delete(key)) removed++;
      this.expiries.delete(key);
    }
    return removed;
  }

  async exists(key: string): Promise<number> {
    this.record('exists', key);
    this.evictIfExpired(key);
    return this.store.has(key) ? 1 : 0;
  }

  async incr(key: string): Promise<number> {
    this.record('incr', key);
    this.evictIfExpired(key);
    const next = Number(this.store.get(key) ?? 0) + 1;
    this.store.set(key, String(next));
    return next;
  }

  async pexpire(key: string, ms: number): Promise<number> {
    this.record('pexpire', key, ms);
    if (!this.store.has(key)) return 0;
    this.expiries.set(key, this.now() + ms);
    return 1;
  }

  async pttl(key: string): Promise<number> {
    this.record('pttl', key);
    this.evictIfExpired(key);
    if (!this.store.has(key)) return -2;
    const expiry = this.expiries.get(key);
    return expiry === undefined ? -1 : Math.max(0, expiry - this.now());
  }

  async keys(pattern: string): Promise<string[]> {
    this.record('keys', pattern);
    return this.matching(pattern);
  }

  /**
   * Cursor-based iteration. Returns two keys per call so tests actually cover
   * the multi-page loop rather than a single convenient batch.
   */
  async scan(cursor: string | number, ...args: unknown[]): Promise<[string, string[]]> {
    this.record('scan', cursor, ...args);

    const flags = args.map((a) => String(a));
    const matchIndex = flags.findIndex((f) => f.toUpperCase() === 'MATCH');
    const pattern = matchIndex !== -1 ? String(args[matchIndex + 1]) : '*';

    const all = this.matching(pattern);
    const start = Number(cursor) || 0;
    const page = all.slice(start, start + 2);
    const next = start + 2 >= all.length ? '0' : String(start + 2);
    return [next, page];
  }

  private matching(pattern: string): string[] {
    const regex = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    const found: string[] = [];
    for (const key of this.store.keys()) {
      this.evictIfExpired(key);
      if (this.store.has(key) && regex.test(key)) found.push(key);
    }
    return found;
  }

  // ── test helpers ──────────────────────────────────────────────────────────

  /** Keys currently held, expiry applied. */
  liveKeys(): string[] {
    return this.matching('*');
  }

  countCalls(command: string): number {
    return this.calls.filter((c) => c.command === command).length;
  }
}

/** A FakeRedis whose `scan` is missing, to exercise the KEYS fallback path. */
export function fakeRedisWithoutScan(now?: () => number): FakeRedis {
  const redis = new FakeRedis(now);
  // The stores feature-detect with `typeof redis.scan !== 'function'`.
  (redis as any).scan = undefined;
  return redis;
}
