import { z } from 'zod';

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

  async clear(): Promise<void> {
    const keys = await this.redis.keys(this.prefix + '*');
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }

  async length(): Promise<number> {
    const keys = await this.redis.keys(this.prefix + '*');
    return keys.length;
  }

  async all(): Promise<SessionData[]> {
    const keys = await this.redis.keys(this.prefix + '*');
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
    this.config = {
      name: 'sessionId',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      secure: false,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      rolling: false,
      genid: () => crypto.randomUUID(),
      ...config,
      domain: config.domain
    };
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