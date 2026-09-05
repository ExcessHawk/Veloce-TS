import { Plugin } from '../core/plugin.js';
import { VeloceTS } from '../core/application.js';
import { MetadataRegistry } from '../core/metadata.js';
import { AuthService, UserProvider } from './auth-service.js';
import { JWTConfig } from './jwt-provider.js';
import { createAuthMiddleware, getCurrentUser, getToken, isAuthenticated, getAuthError } from './decorators.js';
import { AuthenticationException, AuthorizationException } from './exceptions.js';
import { getLogger } from '../logging/logger.js';
import type { AuthConfig, Middleware } from '../types/index.js';
import { Context } from 'hono';
import { z } from 'zod';

export interface AuthPluginConfig {
  jwt: JWTConfig;
  userProvider: UserProvider;
  routes?: {
    login?: string;
    refresh?: string;
    logout?: string;
    register?: string;
  };
  enableDefaultRoutes?: boolean;
}

export class AuthPlugin implements Plugin {
  name = 'auth';
  version = '1.0.0';

  private authService: AuthService;

  constructor(private config: AuthPluginConfig) {
    this.authService = new AuthService(config.jwt, config.userProvider);
  }

  async install(app: VeloceTS): Promise<void> {
    // Add authentication middleware globally
    const authMiddleware = createAuthMiddleware(this.authService.getJWTProvider());
    app.use(authMiddleware);

    // Expose the auth service on the context for downstream middleware/handlers
    app.use(async (c, next) => {
      c.set('authService', this.authService);
      await next();
    });

    // Add auth service to DI container
    app.getContainer().register(AuthService, {
      factory: () => this.authService,
      scope: 'singleton'
    });

    // Add default authentication routes if enabled
    if (this.config.enableDefaultRoutes !== false) {
      this.addDefaultRoutes(app);
    }

    // Enforce @Auth() metadata by injecting a guard into each route's middleware.
    // This MUST happen here, during install(), rather than by wrapping app.compile:
    // install() is itself invoked from inside the already-running VeloceTS.compile(),
    // so reassigning app.compile at this point is a no-op — the wrapper never fires
    // and @Auth() silently becomes unenforced. install() runs before
    // RouterCompiler.compile(), so guards injected into route metadata now land on
    // the live Hono routes.
    this.injectRouteGuards(app);
  }

  /**
   * Prepend an authentication/authorization guard to every route that declares
   * `@Auth()` metadata (directly on the route or via reflect-metadata).
   */
  private injectRouteGuards(app: VeloceTS): void {
    const registry = app.getMetadata();

    for (const route of registry.getRoutes()) {
      const authMetadata = route.target?.prototype
        ? MetadataRegistry.getAuthMetadata(route.target.prototype, route.propertyKey)
        : undefined;
      const authRequired = route.auth?.required || authMetadata?.required;

      if (!authRequired) continue;

      const guard = this.buildAuthMiddleware(route.auth?.config || authMetadata?.config);

      // Re-register the same route (keyed by target + propertyKey, so this replaces
      // it in place) with the guard ahead of any existing middleware.
      registry.registerRoute({
        ...route,
        middleware: [guard, ...(route.middleware || [])],
      });
    }
  }

  private buildAuthMiddleware(authConfig?: AuthConfig): Middleware {
    const authService = this.authService;

    return async (c: Context, next: () => Promise<void>) => {
      const user = c.get('auth.user');

      if (!user) {
        // Missing/invalid credentials is authentication (401), not authorization (403)
        throw new AuthenticationException(c.get('auth.error') || 'Authentication required');
      }

      if (authConfig?.roles?.length) {
        if (!authService.hasRoles(user, authConfig.roles)) {
          throw new AuthorizationException(
            `Required roles: ${authConfig.roles.join(', ')}`
          );
        }
      }

      if (authConfig?.permissions?.length) {
        if (!authService.hasPermissions(user, authConfig.permissions)) {
          throw new AuthorizationException(
            `Required permissions: ${authConfig.permissions.join(', ')}`
          );
        }
      }

      await next();
    };
  }



  private addDefaultRoutes(app: VeloceTS): void {
    const routes = this.config.routes || {};

    // Login route
    app.post(routes.login || '/auth/login', {
      handler: async (c: Context) => {
        const body = await c.req.json();
        const { username, password } = body;

        try {
          const result = await this.authService.login(username, password);
          return {
            success: true,
            user: result.user,
            tokens: result.tokens
          };
        } catch (error) {
          throw this.toAuthFailure(error, 'login', 'Login failed');
        }
      },
      schema: {
        body: z.object({
          username: z.string().min(1),
          password: z.string().min(1)
        })
      }
    });

    // Refresh token route
    app.post(routes.refresh || '/auth/refresh', {
      handler: async (c: Context) => {
        const body = await c.req.json();
        const { refreshToken } = body;

        try {
          const tokens = await this.authService.refresh(refreshToken);
          return {
            success: true,
            tokens
          };
        } catch (error) {
          throw this.toAuthFailure(error, 'refresh', 'Token refresh failed');
        }
      },
      schema: {
        body: z.object({
          refreshToken: z.string().min(1)
        })
      }
    });

    // Logout route
    app.post(routes.logout || '/auth/logout', {
      handler: async (c: Context) => {
        const accessToken = getToken(c);
        const body = await c.req.json();
        const { refreshToken } = body;

        if (accessToken) {
          await this.authService.logout(accessToken, refreshToken);
        }

        return {
          success: true,
          message: 'Logged out successfully'
        };
      },
      schema: {
        body: z.object({
          refreshToken: z.string().optional()
        })
      }
    });

    // Register route (if user provider supports it)
    if ('createUser' in this.config.userProvider) {
      app.post(routes.register || '/auth/register', {
        handler: async (c: Context) => {
          const body = await c.req.json();
          const { username, password, email } = body;

          try {
            const result = await this.authService.register({
              username,
              password,
              email
            });

            return {
              success: true,
              user: result.user,
              tokens: result.tokens
            };
          } catch (error) {
            throw this.toAuthFailure(error, 'register', 'Registration failed');
          }
        },
        schema: {
          body: z.object({
            username: z.string().min(1),
            password: z.string().min(6),
            email: z.string().email().optional()
          })
        }
      });
    }

    // User profile route (protected)
    app.get('/auth/me', {
      handler: async (c: Context) => {
        const user = getCurrentUser(c);
        
        if (!user) {
          throw new AuthenticationException('Not authenticated');
        }

        return {
          success: true,
          user
        };
      }
    });
  }



  /**
   * Map an error thrown by an auth flow to what the client should see.
   *
   * Only genuine credential failures (`AuthenticationException` and its
   * subclasses, e.g. `InvalidTokenException`) are surfaced as 401 with their
   * own message. Anything else — a database outage, a bug in a custom
   * `UserProvider` — is an internal failure: it is logged in full server-side
   * and rethrown unchanged so the error handler turns it into a 500 instead of
   * reporting "invalid credentials" and leaking internal detail as the message.
   */
  private toAuthFailure(error: unknown, flow: string, fallback: string): unknown {
    if (error instanceof AuthenticationException) {
      return error;
    }

    getLogger().error(
      `Auth flow "${flow}" failed with a non-authentication error`,
      error instanceof Error ? error : new Error(String(error)),
      { flow, fallback }
    );

    return error instanceof Error ? error : new Error(fallback);
  }

  getAuthService(): AuthService {
    return this.authService;
  }
}