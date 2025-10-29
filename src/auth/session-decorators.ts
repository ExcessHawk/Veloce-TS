import { MetadataRegistry } from '../core/metadata.js';
import type { SessionManager, SessionData, CSRFProtection } from './session.js';
import type { SessionConfig, SessionMetadata } from '../types/index.js';
import { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { AuthenticationException, AuthorizationException } from './exceptions.js';


/**
 * @Session() decorator for session-based authentication
 */
export function Session(config: SessionConfig = {}): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    const metadata: SessionMetadata = { config };

    MetadataRegistry.defineSession(target, propertyKey as string, metadata);
  };
}

/**
 * @CurrentSession() parameter decorator to inject current session
 */
export function CurrentSession(): ParameterDecorator {
  return (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    if (propertyKey) {
      MetadataRegistry.defineParameter(target, propertyKey as string, parameterIndex, {
        index: parameterIndex,
        type: 'current-session',
        required: true,
      });
    }
  };
}

/**
 * @SessionData() parameter decorator to inject session data
 */
export function SessionData(key?: string): ParameterDecorator {
  return (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    if (propertyKey) {
      MetadataRegistry.defineParameter(target, propertyKey as string, parameterIndex, {
        index: parameterIndex,
        type: 'session-data',
        required: false,
        metadata: { key }
      });
    }
  };
}

/**
 * @CSRFToken() parameter decorator to inject CSRF token
 */
export function CSRFToken(): ParameterDecorator {
  return (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    if (propertyKey) {
      MetadataRegistry.defineParameter(target, propertyKey as string, parameterIndex, {
        index: parameterIndex,
        type: 'csrf-token',
        required: true,
      });
    }
  };
}

/**
 * @RequireCSRF() decorator for CSRF protection
 */
export function RequireCSRF(): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    MetadataRegistry.defineCSRF(target, propertyKey as string, { required: true });
  };
}

/**
 * Create session middleware
 */
export function createSessionMiddleware(
  sessionManager: SessionManager,
  csrfProtection?: CSRFProtection
) {
  return async (c: Context, next: () => Promise<void>) => {
    const config = sessionManager.getConfig();
    
    // Get session ID from cookie
    const sessionId = getCookie(c, config.name);
    
    let session: SessionData | null = null;
    
    if (sessionId) {
      session = await sessionManager.getSession(sessionId);
      
      if (session) {
        // Touch session to update last accessed time
        await sessionManager.touchSession(sessionId);
      }
    }

    // Store session info in context
    c.set('session', session);
    c.set('sessionManager', sessionManager);
    c.set('csrfProtection', csrfProtection);

    await next();
  };
}

/**
 * Session Guard class
 */
export class SessionGuard {
  constructor(
    private sessionManager: SessionManager,
    private csrfProtection?: CSRFProtection
  ) {}

  /**
   * Check if session is required and valid
   */
  checkSession(c: Context, config: SessionConfig): void {
    const session = getCurrentSession(c);
    
    if (config.required && !session) {
      throw new AuthenticationException('Session required');
    }

    if (session && config.csrf) {
      this.checkCSRF(c, session);
    }
  }

  /**
   * Check CSRF token
   */
  checkCSRF(c: Context, session: SessionData): void {
    if (!this.csrfProtection) {
      throw new Error('CSRF protection not configured');
    }

    const csrfToken = c.req.header('X-CSRF-Token') || c.req.query('_csrf');
    
    if (!csrfToken) {
      throw new AuthorizationException('CSRF token required');
    }

    const isValid = this.csrfProtection.validateToken(session.id, csrfToken);
    
    if (!isValid) {
      throw new AuthorizationException('Invalid CSRF token');
    }
  }

  /**
   * Create new session
   */
  async createSession(
    c: Context, 
    userId: string, 
    data: Record<string, any> = {}
  ): Promise<SessionData> {
    const sessionManager = getSessionManager(c);
    
    if (!sessionManager) {
      throw new Error('Session manager not available');
    }

    const ipAddress = c.req.header('X-Forwarded-For') || 
                     c.req.header('X-Real-IP') || 
                     'unknown';
    const userAgent = c.req.header('User-Agent') || 'unknown';

    const session = await sessionManager.createSession(userId, data, {
      ipAddress,
      userAgent
    });

    // Set session cookie
    const cookieOptions = sessionManager.getCookieOptions();
    setCookie(c, sessionManager.getConfig().name, session.id, cookieOptions);

    // Store in context
    c.set('session', session);

    return session;
  }

  /**
   * Update session data
   */
  async updateSession(
    c: Context, 
    data: Record<string, any>
  ): Promise<SessionData | null> {
    const session = getCurrentSession(c);
    const sessionManager = getSessionManager(c);
    
    if (!session || !sessionManager) {
      return null;
    }

    const updatedSession = await sessionManager.updateSession(session.id, data);
    
    if (updatedSession) {
      c.set('session', updatedSession);
    }

    return updatedSession;
  }

  /**
   * Destroy session
   */
  async destroySession(c: Context): Promise<void> {
    const session = getCurrentSession(c);
    const sessionManager = getSessionManager(c);
    
    if (!session || !sessionManager) {
      return;
    }

    await sessionManager.destroySession(session.id);

    // Clear session cookie
    const config = sessionManager.getConfig();
    setCookie(c, config.name, '', { 
      ...sessionManager.getCookieOptions(),
      maxAge: 0 
    });

    // Remove from context
    c.set('session', null);

    // Remove CSRF token
    if (this.csrfProtection) {
      this.csrfProtection.removeToken(session.id);
    }
  }

  /**
   * Regenerate session ID
   */
  async regenerateSession(c: Context): Promise<SessionData | null> {
    const session = getCurrentSession(c);
    const sessionManager = getSessionManager(c);
    
    if (!session || !sessionManager) {
      return null;
    }

    const newSession = await sessionManager.regenerateSession(session.id);
    
    if (newSession) {
      // Update session cookie with new ID
      const cookieOptions = sessionManager.getCookieOptions();
      setCookie(c, sessionManager.getConfig().name, newSession.id, cookieOptions);

      // Store in context
      c.set('session', newSession);

      // Generate new CSRF token
      if (this.csrfProtection) {
        this.csrfProtection.removeToken(session.id);
        this.csrfProtection.generateToken(newSession.id);
      }
    }

    return newSession;
  }

  /**
   * Generate CSRF token for session
   */
  generateCSRFToken(c: Context): string | null {
    const session = getCurrentSession(c);
    
    if (!session || !this.csrfProtection) {
      return null;
    }

    return this.csrfProtection.generateToken(session.id);
  }
}

/**
 * Helper functions
 */
export function getCurrentSession(c: Context): SessionData | null {
  return c.get('session') || null;
}

export function getSessionManager(c: Context): SessionManager | null {
  return c.get('sessionManager') || null;
}

export function getCSRFProtection(c: Context): CSRFProtection | null {
  return c.get('csrfProtection') || null;
}

export function getSessionData(c: Context, key?: string): any {
  const session = getCurrentSession(c);
  
  if (!session) {
    return null;
  }

  if (key) {
    return session.data[key];
  }

  return session.data;
}

export function isSessionAuthenticated(c: Context): boolean {
  const session = getCurrentSession(c);
  return session !== null;
}

export function getSessionUserId(c: Context): string | null {
  const session = getCurrentSession(c);
  return session?.userId || null;
}

export function setSessionData(c: Context, key: string, value: any): void {
  const session = getCurrentSession(c);
  
  if (session) {
    session.data[key] = value;
    c.set('session', session);
  }
}

export function removeSessionData(c: Context, key: string): void {
  const session = getCurrentSession(c);
  
  if (session && key in session.data) {
    delete session.data[key];
    c.set('session', session);
  }
}