import { z } from 'zod';
import { createHmac } from 'node:crypto';
import { getLogger } from '../logging/logger.js';

export interface SessionData {
  id: string;
  userId: string;
  data: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
  ipAddress?: string;
  userAgent?: string;
  csrfToken?: string;
}

export interface SessionConfig {
  name?: string;
  secret: string;
  maxAge?: number; // in milliseconds
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: 'strict' | 'lax' | 'none';
  domain?: string;
  path?: string;
  rolling?: boolean; // Extend session on each request
  genid?: () => string; // Custom session ID generator
}

export interface SessionStore {
  get(sessionId: string): Promise<SessionData | null>;
  set(sessionId: string, session: SessionData): Promise<void>;
  destroy(sessionId: string): Promise<void>;
  touch(sessionId: string): Promise<void>; // Update last accessed time
  clear(): Promise<void>; // Clear all sessions
  length(): Promise<number>; // Get session count
  all(): Promise<SessionData[]>; // Get all sessions (for admin)
}

export class MemorySessionStore implements SessionStore {
  private sessions: Map<string, SessionData> = new Map();
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor(cleanupIntervalMs = 60_000) {
    this.cleanupTimer = setInterval(() => this.cleanup(), cleanupIntervalMs);
    // unref() keeps this timer from holding the event loop open. Registering
    // process SIGTERM/SIGINT listeners here (as this used to) removed Node's
    // default signal behaviour for the whole application, so a script merely
    // constructing a store stopped exiting on Ctrl+C.
    this.cleanupTimer.unref?.();
  }

  /**
   * Stop the cleanup timer. Named `stopCleanup` rather than `destroy` because
   * `destroy(sessionId)` is already the SessionStore method that removes a
   * single session.
   */
  stopCleanup(): void {
    clearInterval(this.cleanupTimer);
  }

  async get(sessionId: string): Promise<SessionData | null> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return null;
    }

    // Check if session is expired
    if (session.expiresAt && session.expiresAt < new Date()) {
      this.sessions.delete(sessionId);
      return null;
    }

    return session;
  }

  async set(sessionId: string, session: SessionData): Promise<void> {
    this.sessions.set(sessionId, session);
  }

  async destroy(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async touch(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.updatedAt = new Date();
      this.sessions.set(sessionId, session);
    }
  }

  async clear(): Promise<void> {
    this.sessions.clear();
  }

  async length(): Promise<number> {
    return this.sessions.size;
  }

  async all(): Promise<SessionData[]> {
    return Array.from(this.sessions.values());
  }

  // Cleanup expired sessions
  cleanup(): void {
    const now = new Date();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.expiresAt && session.expiresAt < now) {
        this.sessions.delete(sessionId);
      }
    }
  }
}

export class RedisSessionStore implements SessionStore {
  private prefix: string = 'sess:';

  constructor(private redis: any, prefix?: string) {
    if (prefix) {
      this.prefix = prefix;
    }
  }

  async get(sessionId: string): Promise<SessionData | null> {
    const key = this.prefix + sessionId;
    const data = await this.redis.get(key);

    if (!data) {
      return null;
    }

    try {
      const session = JSON.parse(data);
      // Convert date strings back to Date objects
      session.createdAt = new Date(session.createdAt);
      session.updatedAt = new Date(session.updatedAt);
      if (session.expiresAt) {
        session.expiresAt = new Date(session.expiresAt);
      }
      return session;
    } catch (error) {
      return null;
    }
  }

  async set(sessionId: string, session: SessionData): Promise<void> {
    const key = this.prefix + sessionId;
    const data = JSON.stringify(session);

    if (session.expiresAt) {
      const ttl = Math.floor((session.expiresAt.getTime() - Date.now()) / 1000);
      if (ttl > 0) {
        await this.redis.setex(key, ttl, data);
      }
    } else {
      await this.redis.set(key, data);
    }
  }

  async destroy(sessionId: string): Promise<void> {
    const key = this.prefix + sessionId;
    await this.redis.del(key);
  }

  async touch(sessionId: string): Promise<void> {
    const session = await this.get(sessionId);
    if (session) {
      session.updatedAt = new Date();
      await this.set(sessionId, session);
    }
  }

  /**
   * Cursor-based SCAN instead of KEYS — KEYS blocks the Redis event loop
   * on large keyspaces. Falls back to KEYS if the client lacks scan().
   */
  private async scanKeys(): Promise<string[]> {
    const pattern = this.prefix + '*';
    if (typeof this.redis.scan !== 'function') {
      return this.redis.keys(pattern);
    }

    const found: string[] = [];
    let cursor: string | number = '0';
    do {
      const reply: any = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
      if (Array.isArray(reply)) {
        cursor = reply[0];
        found.push(...reply[1]);
      } else {
        cursor = reply.cursor;
        found.push(...reply.keys);
      }
    } while (String(cursor) !== '0');

    return found;
  }

  async clear(): Promise<void> {
    const keys = await this.scanKeys();
    const BATCH = 500;
    for (let i = 0; i < keys.length; i += BATCH) {
      const chunk = keys.slice(i, i + BATCH);
      if (chunk.length > 0) {
        await this.redis.del(...chunk);
      }
    }
  }

  async length(): Promise<number> {
    const keys = await this.scanKeys();
    return keys.length;
  }

  async all(): Promise<SessionData[]> {
    const keys = await this.scanKeys();
    const sessions: SessionData[] = [];

    for (const key of keys) {
      const data = await this.redis.get(key);
      if (data) {
        try {
          const session = JSON.parse(data);
          session.createdAt = new Date(session.createdAt);
          session.updatedAt = new Date(session.updatedAt);
          if (session.expiresAt) {
            session.expiresAt = new Date(session.expiresAt);
          }
          sessions.push(session);
        } catch (error) {
          // Skip invalid sessions
        }
      }
    }

    return sessions;
  }
}

export class SessionManager {
  private config: Required<Omit<SessionConfig, 'domain'>> & { domain?: string };

  constructor(
    private store: SessionStore,
    config: SessionConfig
  ) {
    if (!config.secret) {
      throw new Error(
        'SessionConfig.secret is required — it signs the session cookie so a client cannot forge a session id.'
      );
    }

    const isProduction = typeof process !== 'undefined' && process.env.NODE_ENV === 'production';

    this.config = {
      name: 'sessionId',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      // Secure cookies by default in production; a session cookie sent over
      // plain HTTP is interceptable.
      secure: isProduction,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      rolling: false,
      genid: () => crypto.randomUUID(),
      ...config,
      domain: config.domain
    };

    if (isProduction && this.config.secure === false) {
      getLogger().warn(
        'Session cookie has secure: false in production — it will be sent over plain HTTP.',
        { cookie: this.config.name }
      );
    }
  }

  /**
   * Create a new session
   */
  async createSession(userId: string, data: Record<string, any> = {}, options?: {
    ipAddress?: string;
    userAgent?: string;
    maxAge?: number;
  }): Promise<SessionData> {
    const sessionId = this.config.genid();
    const now = new Date();
    const maxAge = options?.maxAge || this.config.maxAge;

    const session: SessionData = {
      id: sessionId,
      userId,
      data,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + maxAge),
      ipAddress: options?.ipAddress,
      userAgent: options?.userAgent,
      csrfToken: this.generateCSRFToken()
    };

    await this.store.set(sessionId, session);
    return session;
  }

  /**
   * Get session by ID
   */
  async getSession(sessionId: string): Promise<SessionData | null> {
    return await this.store.get(sessionId);
  }

  /**
   * Update session data
   */
  async updateSession(sessionId: string, data: Record<string, any>): Promise<SessionData | null> {
    const session = await this.store.get(sessionId);

    if (!session) {
      return null;
    }

    session.data = { ...session.data, ...data };
    session.updatedAt = new Date();

    // Extend session if rolling is enabled
    if (this.config.rolling) {
      session.expiresAt = new Date(Date.now() + this.config.maxAge);
    }

    await this.store.set(sessionId, session);
    return session;
  }

  /**
   * Touch session (update last accessed time)
   */
  async touchSession(sessionId: string): Promise<void> {
    if (this.config.rolling) {
      const session = await this.store.get(sessionId);
      if (session) {
        session.updatedAt = new Date();
        session.expiresAt = new Date(Date.now() + this.config.maxAge);
        await this.store.set(sessionId, session);
      }
    } else {
      await this.store.touch(sessionId);
    }
  }

  /**
   * Destroy session
   */
  async destroySession(sessionId: string): Promise<void> {
    await this.store.destroy(sessionId);
  }

  /**
   * Regenerate session ID (for security)
   */
  async regenerateSession(sessionId: string): Promise<SessionData | null> {
    const session = await this.store.get(sessionId);

    if (!session) {
      return null;
    }

    // Create new session with same data but new ID
    const newSessionId = this.config.genid();
    const newSession: SessionData = {
      ...session,
      id: newSessionId,
      updatedAt: new Date(),
      csrfToken: this.generateCSRFToken()
    };

    // Save new session and destroy old one
    await this.store.set(newSessionId, newSession);
    await this.store.destroy(sessionId);

    return newSession;
  }

  /**
   * Get all sessions for a user
   */
  async getUserSessions(userId: string): Promise<SessionData[]> {
    const allSessions = await this.store.all();
    return allSessions.filter(session => session.userId === userId);
  }

  /**
   * Destroy all sessions for a user
   */
  async destroyUserSessions(userId: string): Promise<void> {
    const userSessions = await this.getUserSessions(userId);

    for (const session of userSessions) {
      await this.store.destroy(session.id);
    }
  }

  /**
   * Sign a session id for transport in a cookie: `<id>.<hmac>`.
   *
   * `SessionConfig.secret` is what makes the cookie tamper-evident. Without a
   * signature the cookie is just the raw id, so anyone could swap in another
   * (guessed or observed) session id and be served that session.
   */
  signSessionId(sessionId: string): string {
    return `${sessionId}.${this.hmac(sessionId)}`;
  }

  /**
   * Verify a signed session cookie and return the id it carries.
   * Returns `null` when the value is unsigned, malformed, or tampered with.
   */
  unsignSessionId(signed: string): string | null {
    const separator = signed.lastIndexOf('.');
    if (separator <= 0) return null;

    const sessionId = signed.slice(0, separator);
    const signature = signed.slice(separator + 1);
    const expected = this.hmac(sessionId);

    if (!this.timingSafeEqual(signature, expected)) {
      return null;
    }

    return sessionId;
  }

  private hmac(value: string): string {
    return createHmac('sha256', this.config.secret).update(value).digest('base64url');
  }

  /** Constant-time comparison, so signature checks don't leak via timing. */
  private timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
  }

  /**
   * Validate CSRF token
   */
  validateCSRFToken(session: SessionData, token: string): boolean {
    return session.csrfToken === token;
  }

  /**
   * Generate CSRF token
   */
  private generateCSRFToken(): string {
    return crypto.randomUUID();
  }

  /**
   * Get session cookie options
   */
  getCookieOptions(): {
    maxAge: number;
    secure: boolean;
    httpOnly: boolean;
    sameSite: 'strict' | 'lax' | 'none';
    domain?: string;
    path: string;
  } {
    const options: {
      maxAge: number;
      secure: boolean;
      httpOnly: boolean;
      sameSite: 'strict' | 'lax' | 'none';
      domain?: string;
      path: string;
    } = {
      maxAge: this.config.maxAge,
      secure: this.config.secure,
      httpOnly: this.config.httpOnly,
      sameSite: this.config.sameSite,
      path: this.config.path
    };

    if (this.config.domain) {
      options.domain = this.config.domain;
    }

    return options;
  }

  /**
   * Get session configuration
   */
  getConfig(): Required<Omit<SessionConfig, 'domain'>> & { domain?: string } {
    return { ...this.config };
  }

  /**
   * Get store instance
   */
  getStore(): SessionStore {
    return this.store;
  }
}

// CSRF Protection utilities
export class CSRFProtection {
  private tokenStore: Map<string, { token: string; expiresAt: Date }> = new Map();
  private readonly tokenTTL = 60 * 60 * 1000; // 1 hour

  /**
   * Generate CSRF token for session
   */
  generateToken(sessionId: string): string {
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + this.tokenTTL);

    this.tokenStore.set(sessionId, { token, expiresAt });

    // Cleanup expired tokens
    this.cleanup();

    return token;
  }

  /**
   * Validate CSRF token
   */
  validateToken(sessionId: string, token: string): boolean {
    const storedToken = this.tokenStore.get(sessionId);

    if (!storedToken) {
      return false;
    }

    // Check if token is expired
    if (storedToken.expiresAt < new Date()) {
      this.tokenStore.delete(sessionId);
      return false;
    }

    return storedToken.token === token;
  }

  /**
   * Remove token for session
   */
  removeToken(sessionId: string): void {
    this.tokenStore.delete(sessionId);
  }

  /**
   * Cleanup expired tokens
   */
  private cleanup(): void {
    const now = new Date();
    for (const [sessionId, tokenData] of this.tokenStore.entries()) {
      if (tokenData.expiresAt < now) {
        this.tokenStore.delete(sessionId);
      }
    }
  }
}

// Validation schemas
export const SessionDataSchema = z.object({
  id: z.string(),
  userId: z.string(),
  data: z.record(z.any()),
  createdAt: z.date(),
  updatedAt: z.date(),
  expiresAt: z.date().optional(),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
  csrfToken: z.string().optional()
});

export const SessionConfigSchema = z.object({
  name: z.string().optional(),
  secret: z.string(),
  maxAge: z.number().optional(),
  secure: z.boolean().optional(),
  httpOnly: z.boolean().optional(),
  sameSite: z.enum(['strict', 'lax', 'none']).optional(),
  domain: z.string().optional(),
  path: z.string().optional(),
  rolling: z.boolean().optional()
});

export const CreateSessionSchema = z.object({
  userId: z.string(),
  data: z.record(z.any()).optional(),
  maxAge: z.number().optional(),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional()
});

export const UpdateSessionSchema = z.object({
  data: z.record(z.any())
});