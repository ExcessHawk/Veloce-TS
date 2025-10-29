import { Plugin } from '../core/plugin.js';
import { VeloceTS } from '../core/application.js';
import { MetadataRegistry } from '../core/metadata.js';
import { AuthService, UserProvider } from './auth-service.js';
import { JWTConfig } from './jwt-provider.js';
import { createAuthMiddleware, getCurrentUser, getToken, isAuthenticated, getAuthError } from './decorators.js';
import { AuthenticationException, AuthorizationException } from './exceptions.js';
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

    // Add auth service to DI container
    app.getContainer().register(AuthService, {
      factory: () => this.authService,
      scope: 'singleton'
    });

    // Add default authentication routes if enabled
    if (this.config.enableDefaultRoutes !== false) {
      this.addDefaultRoutes(app);
    }

    // Extend router compiler to handle auth metadata
    this.extendRouterCompiler(app);
  }

  private extendRouterCompiler(app: VeloceTS): void {
    // Add auth middleware that runs before route handlers
    app.use(async (c, next) => {
      // Store auth service in context for later use
      c.set('authService', this.authService);
      
      // Continue to next middleware/handler
      await next();
    });
    
    // Override the compile method to add route-specific auth checks
    const originalCompile = app.compile.bind(app);
    
    app.compile = async () => {
      // First compile normally
      await originalCompile();
      
      // Then add auth checks for each route that needs them
      const hono = app.getHono();
      const routes = app.getMetadata().getRoutes();
      
      for (const route of routes) {
        // Check if auth metadata exists in reflect-metadata directly
        const authMetadata = MetadataRegistry.getAuthMetadata(route.target.prototype, route.propertyKey);
        const authRequired = route.auth?.required || authMetadata?.required;
        
        if (authRequired) {
          console.log('Adding auth middleware for route:', route.path, route.method);
          const authConfig = route.auth?.config || authMetadata?.config;
          
          // Add middleware specifically for this route
          hono.use(route.path, async (c, next) => {
            console.log('Auth middleware executing for:', c.req.path, c.req.method, 'target:', route.path, route.method);
            
            // Only apply to the specific method
            if (c.req.method !== route.method) {
              console.log('Method mismatch, skipping auth check');
              return next();
            }
            
            console.log('Checking authentication...');
            
            // Check authentication
            const user = (c as any).get('auth.user');
            const error = (c as any).get('auth.error');
            
            if (!user) {
              const authError = error || 'Authentication required';
              console.log('No user found, throwing auth exception');
              throw new AuthenticationException(authError);
            }

            // Check roles if specified
            if (authConfig?.roles?.length) {
              if (!this.authService.hasRoles(user, authConfig.roles)) {
                throw new AuthorizationException(
                  `Required roles: ${authConfig.roles.join(', ')}`
                );
              }
            }

            // Check permissions if specified
            if (authConfig?.permissions?.length) {
              if (!this.authService.hasPermissions(user, authConfig.permissions)) {
                throw new AuthorizationException(
                  `Required permissions: ${authConfig.permissions.join(', ')}`
                );
              }
            }
            
            await next();
          });
        }
      }
    };
  }

  private buildPath(route: any): string {
    // The route already contains the full path from the router compiler
    return route.path;
  }

  private pathMatches(routePath: string, requestPath: string): boolean {
    // Simple path matching - convert route params to regex
    const pattern = routePath.replace(/:([^/]+)/g, '([^/]+)');
    const regex = new RegExp(`^${pattern}$`);
    return regex.test(requestPath);
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
          throw new AuthenticationException(
            error instanceof Error ? error.message : 'Login failed'
          );
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
          throw new AuthenticationException(
            error instanceof Error ? error.message : 'Token refresh failed'
          );
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
            throw new AuthenticationException(
              error instanceof Error ? error.message : 'Registration failed'
            );
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



  getAuthService(): AuthService {
    return this.authService;
  }
}