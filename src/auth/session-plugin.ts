import { Plugin } from '../core/plugin.js';
import { VeloceTS } from '../core/application.js';
import { 
  SessionManager, 
  SessionStore, 
  MemorySessionStore, 
  RedisSessionStore,
  SessionConfig as SessionManagerConfig,
  CSRFProtection
} from './session.js';
import { createSessionMiddleware, SessionGuard, getCurrentSession } from './session-decorators.js';
import { MetadataRegistry } from '../core/metadata.js';
import { AuthenticationException, AuthorizationException } from './exceptions.js';
import type { Middleware, SessionConfig } from '../types/index.js';
import { Context } from 'hono';
import { z } from 'zod';

export interface SessionPluginConfig {
  store?: SessionStore;
  storeType?: 'memory' | 'redis';
  redis?: any; // Redis client instance
  session: SessionManagerConfig;
  csrf?: {
    enabled?: boolean;
    tokenTTL?: number;
  };
  routes?: {
    create?: string;
    destroy?: string;
    regenerate?: string;
    data?: string;
    csrf?: string;
  };
  enableManagementRoutes?: boolean;
}

export class SessionPlugin implements Plugin {
  name = 'session';
  version = '1.0.0';

  private sessionManager: SessionManager;
  private csrfProtection?: CSRFProtection;
  private guard: SessionGuard;
  private cleanupIntervalId?: ReturnType<typeof setInterval>;

  constructor(private config: SessionPluginConfig) {
    // Initialize session store
    let store: SessionStore;
    
    if (config.store) {
      store = config.store;
    } else if (config.storeType === 'redis' && config.redis) {
      store = new RedisSessionStore(config.redis);
    } else {
      store = new MemorySessionStore();
    }

    // Initialize session manager
    this.sessionManager = new SessionManager(store, config.session);

    // Initialize CSRF protection if enabled
    if (config.csrf?.enabled !== false) {
      this.csrfProtection = new CSRFProtection();
    }

    this.guard = new SessionGuard(this.sessionManager, this.csrfProtection);
  }

  async install(app: VeloceTS): Promise<void> {
    // Add session middleware globally
    const sessionMiddleware = createSessionMiddleware(this.sessionManager, this.csrfProtection);
    app.use(sessionMiddleware);

    // Add session manager to DI container
    app.getContainer().register(SessionManager, {
      factory: () => this.sessionManager,
      scope: 'singleton'
    });

    // Add session guard to DI container
    app.getContainer().register(SessionGuard, {
      factory: () => this.guard,
      scope: 'singleton'
    });

    // Add CSRF protection to DI container if enabled
    if (this.csrfProtection) {
      app.getContainer().register(CSRFProtection, {
        factory: () => this.csrfProtection!,
        scope: 'singleton'
      });
    }

    // Enforce @Session() / @RequireCSRF() metadata
    this.injectRouteGuards(app);

    // Add management routes if enabled
    if (this.config.enableManagementRoutes !== false) {
      this.addManagementRoutes(app);
    }

    // Set up cleanup for memory store
    if (this.sessionManager.getStore() instanceof MemorySessionStore) {
      this.setupCleanup();
    }
  }

  /**
   * Prepend a session/CSRF guard to every route declaring `@Session()` or
   * `@RequireCSRF()`.
   *
   * This runs during install() — before RouterCompiler.compile() — rather than
   * by wrapping app.compile: install() is called from inside the already-running
   * VeloceTS.compile(), so a compile wrapper installed here would never fire and
   * the decorators would be silently unenforced.
   */
  private injectRouteGuards(app: VeloceTS): void {
    const registry = app.getMetadata();

    for (const route of registry.getRoutes()) {
      const sessionMeta = route.session
        ?? (route.target?.prototype
          ? MetadataRegistry.getSessionMetadata(route.target.prototype, route.propertyKey)
          : undefined);
      const csrfMeta = route.csrf
        ?? (route.target?.prototype
          ? MetadataRegistry.getCSRFMetadata(route.target.prototype, route.propertyKey)
          : undefined);

      if (!sessionMeta && !csrfMeta?.required) continue;

      const guard = this.buildSessionMiddleware(sessionMeta?.config, csrfMeta?.required === true);
      registry.registerRoute({
        ...route,
        middleware: [guard, ...(route.middleware || [])],
      });
    }
  }

  private buildSessionMiddleware(
    sessionConfig: SessionConfig | undefined,
    csrfRequired: boolean
  ): Middleware {
    const guard = this.guard;

    return async (c: Context, next: () => Promise<void>) => {
      const session = getCurrentSession(c);

      if (sessionConfig?.required && !session) {
        throw new AuthenticationException('Session required');
      }

      // @RequireCSRF() (or @Session({ csrf: true })) must reject the request even
      // when there is no session — otherwise an unauthenticated caller bypasses
      // the check entirely.
      if (csrfRequired || sessionConfig?.csrf) {
        if (!session) {
          throw new AuthorizationException('CSRF token required');
        }
        guard.checkCSRF(c, session);
      }

      if (sessionConfig?.regenerate && session) {
        await guard.regenerateSession(c);
      }

      await next();
    };
  }

  private addManagementRoutes(app: VeloceTS): void {
    const routes = this.config.routes || {};

    // Create session
    app.post(routes.create || '/session/create', {
      handler: async (c: Context) => {
        const body = await c.req.json();
        const { userId, data } = body;

        const session = await this.guard.createSession(c, userId, data);

        return c.json({
          success: true,
          message: 'Session created successfully',
          session: {
            id: session.id,
            userId: session.userId,
            data: session.data,
            createdAt: session.createdAt,
            expiresAt: session.expiresAt
          }
        });
      },
      schema: {
        body: z.object({
          userId: z.string(),
          data: z.record(z.any()).optional()
        })
      }
    });

    // Destroy session
    app.post(routes.destroy || '/session/destroy', {
      handler: async (c: Context) => {
        await this.guard.destroySession(c);

        return c.json({
          success: true,
          message: 'Session destroyed successfully'
        });
      }
    });

    // Regenerate session ID
    app.post(routes.regenerate || '/session/regenerate', {
      handler: async (c: Context) => {
        const newSession = await this.guard.regenerateSession(c);

        if (!newSession) {
          return c.json({ error: 'No active session to regenerate' }, 400);
        }

        return c.json({
          success: true,
          message: 'Session regenerated successfully',
          session: {
            id: newSession.id,
            userId: newSession.userId,
            data: newSession.data,
            createdAt: newSession.createdAt,
            expiresAt: newSession.expiresAt
          }
        });
      }
    });

    // Get/Update session data
    app.get(routes.data || '/session/data', {
      handler: (c: Context) => {
        const session = c.get('session');

        if (!session) {
          return c.json({ error: 'No active session' }, 400);
        }

        return c.json({
          success: true,
          data: session.data
        });
      }
    });

    app.put(routes.data || '/session/data', {
      handler: async (c: Context) => {
        const body = await c.req.json();
        const { data } = body;

        const updatedSession = await this.guard.updateSession(c, data);

        if (!updatedSession) {
          return c.json({ error: 'No active session to update' }, 400);
        }

        return c.json({
          success: true,
          message: 'Session data updated successfully',
          data: updatedSession.data
        });
      },
      schema: {
        body: z.object({
          data: z.record(z.any())
        })
      }
    });

    // Get CSRF token
    if (this.csrfProtection) {
      app.get(routes.csrf || '/session/csrf-token', {
        handler: (c: Context) => {
          const token = this.guard.generateCSRFToken(c);

          if (!token) {
            return c.json({ error: 'No active session or CSRF not enabled' }, 400);
          }

          return c.json({
            success: true,
            csrfToken: token
          });
        }
      });
    }

    // Get session info
    app.get('/session/info', {
      handler: (c: Context) => {
        const session = c.get('session');

        if (!session) {
          return c.json({
            success: true,
            authenticated: false,
            session: null
          });
        }

        return c.json({
          success: true,
          authenticated: true,
          session: {
            id: session.id,
            userId: session.userId,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            expiresAt: session.expiresAt,
            ipAddress: session.ipAddress,
            userAgent: session.userAgent
          }
        });
      }
    });

    // Get all sessions for current user
    app.get('/session/all', {
      handler: async (c: Context) => {
        const session = c.get('session');

        if (!session) {
          return c.json({ error: 'No active session' }, 400);
        }

        const userSessions = await this.sessionManager.getUserSessions(session.userId);

        return c.json({
          success: true,
          sessions: userSessions.map(s => ({
            id: s.id,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
            expiresAt: s.expiresAt,
            ipAddress: s.ipAddress,
            userAgent: s.userAgent,
            current: s.id === session.id
          }))
        });
      }
    });

    // Destroy all sessions for current user
    app.post('/session/destroy-all', {
      handler: async (c: Context) => {
        const session = c.get('session');

        if (!session) {
          return c.json({ error: 'No active session' }, 400);
        }

        await this.sessionManager.destroyUserSessions(session.userId);

        return c.json({
          success: true,
          message: 'All sessions destroyed successfully'
        });
      }
    });

    // Session statistics (admin only — requires active session)
    app.get('/session/stats', {
      handler: async (c: Context) => {
        const session = c.get('session');
        if (!session) {
          return c.json({ error: 'Authentication required' }, 401);
        }

        const store = this.sessionManager.getStore();
        const totalSessions = await store.length();
        const allSessions = await store.all();

        const stats = {
          totalSessions,
          activeSessions: allSessions.filter(s => !s.expiresAt || s.expiresAt > new Date()).length,
          expiredSessions: allSessions.filter(s => s.expiresAt && s.expiresAt <= new Date()).length,
          uniqueUsers: new Set(allSessions.map(s => s.userId)).size
        };

        return c.json({
          success: true,
          stats
        });
      }
    });
  }

  private setupCleanup(): void {
    if (this.cleanupIntervalId) return;

    const cleanupInterval = 15 * 60 * 1000;
    
    this.cleanupIntervalId = setInterval(() => {
      const store = this.sessionManager.getStore();
      if (store instanceof MemorySessionStore) {
        store.cleanup();
      }
    }, cleanupInterval);

    if (typeof process !== 'undefined' && process.on) {
      process.on('exit', () => {
        if (this.cleanupIntervalId) clearInterval(this.cleanupIntervalId);
      });
    }
  }

  getSessionManager(): SessionManager {
    return this.sessionManager;
  }

  getCSRFProtection(): CSRFProtection | undefined {
    return this.csrfProtection;
  }

  getGuard(): SessionGuard {
    return this.guard;
  }
}