import type { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Context } from '../types';
import { MetadataRegistry } from './metadata';
import { DIContainer } from '../dependencies/container';
import { ValidationEngine } from '../validation/validator';
import { ResponseSerializer } from '../responses/response';
import { ErrorHandler } from '../errors/handler';
import { MetadataCompiler, type CompiledRouteMetadata } from './compiled-metadata';
import type { RouteMetadata, ParameterMetadata, DependencyMetadata } from '../types';
import { BadRequestException } from '../errors/exceptions';

/**
 * RouterCompiler converts metadata from decorators and functional API
 * into actual Hono routes with full validation and dependency injection
 */
export class RouterCompiler {
  // Cache compiled metadata for performance
  private compiledRoutes: Map<string, CompiledRouteMetadata> = new Map();

  constructor(
    private app: Hono,
    private metadata: MetadataRegistry,
    private container: DIContainer,
    private validator: ValidationEngine,
    private errorHandler: ErrorHandler
  ) {}

  /**
   * Compile all registered routes and register them with Hono
   * This is the main entry point that processes all route metadata
   */
  compile(): void {
    const routes = this.metadata.getRoutes();

    // Pre-compile all routes for performance
    const compiledRoutes = MetadataCompiler.compileAll(routes);

    for (const route of compiledRoutes) {
      // Cache compiled route for potential reuse
      const routeKey = `${route.target.name}:${route.propertyKey}`;
      this.compiledRoutes.set(routeKey, route);

      const handler = this.createHandler(route);
      const path = this.normalizePath(route.path);
      const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'delete' | 'patch';

      // Register route with Hono, including any middleware
      // Note: Controller middleware is already included in route.middleware by application.ts
      if (route.middleware && route.middleware.length > 0) {
        this.app[method](path, ...route.middleware, handler);
      } else {
        this.app[method](path, handler);
      }
    }
  }

  /**
   * Normalize a path to ensure it follows Hono's conventions
   * Converts FastAPI-style path parameters to Hono format
   */
  private normalizePath(path: string): string {
    // Ensure path starts with /
    if (!path.startsWith('/')) {
      path = '/' + path;
    }

    // Convert FastAPI-style {param} to Hono-style :param
    path = path.replace(/\{([^}]+)\}/g, ':$1');

    // Remove trailing slash unless it's the root path
    if (path.length > 1 && path.endsWith('/')) {
      path = path.slice(0, -1);
    }

    return path;
  }

  /**
   * Create a Hono handler function for a route
   * Integrates parameter extraction, validation, dependency injection, error handling, and caching
   */
  public createHandler(route: CompiledRouteMetadata): (c: Context) => Promise<any> {
    return async (c: Context) => {
      try {
        // Store route metadata in context for auth checks
        c.set('routeMetadata', route);
        
        // Check if route has caching enabled
        const cacheConfig = (route as any).cache;
        let cacheKey: string | null = null;
        let cacheManager: any = null;

        if (cacheConfig) {
          const { CacheManager } = await import('../cache/manager.js');
          const { parseTTL } = await import('../cache/types.js');
          cacheManager = CacheManager;

          // Generate cache key
          const params = c.req.param();
          const query = cacheConfig.includeQuery ? c.req.query() : undefined;
          
          cacheKey = CacheManager.generateKey(
            route.method,
            route.path,
            params,
            query,
            cacheConfig
          );

          // Try to get from cache
          const cached = await CacheManager.get(cacheKey, cacheConfig.store);
          if (cached !== null) {
            c.header('X-Cache', 'HIT');
            return this.serializeResponse(c, cached);
          }

          c.header('X-Cache', 'MISS');
        }
        
        // 1. Extract and validate parameters from the request
        const args = await this.extractParameters(c, route.parameters);

        // 2. Resolve dependencies with the DI container
        const deps = await this.resolveDependencies(c, route.dependencies);

        // 3. Merge parameters and dependencies into correct order
        const allArgs = this.mergeArguments(args, deps, route.parameters, route.maxArgumentIndex);

        // 4. Execute the handler
        let result: any;

        // Check if this is a functional route (has handler property)
        if ((route as any).handler) {
          // Functional API route - call handler directly
          result = await (route as any).handler(c, ...allArgs);
        } else {
          // Decorator-based route - instantiate controller and call method
          const instance = await this.container.resolve(route.target, {
            scope: 'transient',
            context: c
          });
          
          if (typeof instance[route.propertyKey] !== 'function') {
            throw new Error(`Method ${route.propertyKey} not found on controller ${route.target.name}`);
          }
          
          result = await instance[route.propertyKey](...allArgs);
        }

        // Cache the result if caching is enabled
        if (cacheConfig && cacheKey && cacheManager) {
          // Check custom condition
          if (!cacheConfig.condition || cacheConfig.condition(result)) {
            const { parseTTL } = await import('../cache/types.js');
            const ttl = parseTTL(cacheConfig.ttl);
            await cacheManager.set(cacheKey, result, ttl, cacheConfig.store);
          }
        }

        // Handle cache invalidation if configured
        const invalidatePatterns = (route as any).cacheInvalidate;
        if (invalidatePatterns && Array.isArray(invalidatePatterns)) {
          if (!cacheManager) {
            const { CacheManager } = await import('../cache/manager.js');
            cacheManager = CacheManager;
          }

          const params = c.req.param();
          for (const pattern of invalidatePatterns) {
            // Replace placeholders with actual values
            let resolvedPattern = pattern;
            if (params) {
              for (const [key, value] of Object.entries(params)) {
                resolvedPattern = resolvedPattern.replace(`{${key}}`, String(value));
              }
            }
            await cacheManager.invalidate(resolvedPattern);
          }
        }

        // 5. Serialize and return the response
        return this.serializeResponse(c, result);
      } catch (error) {
        // 6. Handle errors and pass to error handler
        return await this.handleError(c, error);
      }
    };
  }

  /**
   * Serialize the handler result into a proper HTTP response
   * Delegates to ResponseSerializer for consistent handling
   */
  private serializeResponse(c: Context, result: any): any {
    return ResponseSerializer.serialize(c, result);
  }

  /**
   * Get route metadata for the current request context
   */
  private getRouteMetadataForContext(c: Context): CompiledRouteMetadata | null {
    // This is a simplified approach - in a real implementation we'd need to
    // match the current route path and method to find the metadata
    // For now, we'll store it in the context during route compilation
    return c.get('routeMetadata') || null;
  }

  /**
   * Check if authentication is required for a route
   */
  private isAuthRequired(routeMetadata: CompiledRouteMetadata): boolean {
    // Check if the route has @Auth() decorator metadata
    if (routeMetadata.auth?.required) {
      return true;
    }

    // Check if any parameter requires authentication (has current-user type)
    return routeMetadata.parameters.some(param => param.type === 'current-user');
  }

  /**
   * Handle errors that occur during request processing
   * Delegates to ErrorHandler for consistent error handling
   */
  private async handleError(c: Context, error: any): Promise<any> {
    // Delegate to the ErrorHandler
    return await this.errorHandler.handle(error, c);
  }

  /**
   * Extract and validate parameters from the request context
   * Handles body, query, params, headers, cookies, and special types
   */
  private async extractParameters(
    c: Context,
    params: ParameterMetadata[]
  ): Promise<any[]> {
    const extracted: any[] = [];

    for (const param of params) {
      // Skip undefined entries (sparse array handling)
      if (!param) continue;
      
      let value: any;

      switch (param.type) {
        case 'body':
          // Extract request body as JSON
          try {
            value = await c.req.json();
          } catch (error) {
            value = null;
          }
          break;

        case 'query':
          // Extract query parameters
          if (param.name) {
            // Extract specific query parameter
            value = c.req.query(param.name);
          } else {
            // Extract all query parameters
            value = c.req.query();
          }
          
          // Validate with schema if provided
          if (param.schema && value !== undefined) {
            try {
              value = param.schema.parse(value);
            } catch (error) {
              throw new BadRequestException(`Invalid query parameter: ${error}`);
            }
          }
          break;

        case 'param':
          // Extract path parameters
          if (param.name) {
            // Extract specific path parameter
            value = c.req.param(param.name);
          } else {
            // Extract all path parameters
            value = c.req.param();
          }
          break;

        case 'header':
          // Extract headers
          if (param.name) {
            // Extract specific header
            value = c.req.header(param.name);
          } else {
            // Extract all headers as object
            const headers: Record<string, string> = {};
            c.req.raw.headers.forEach((val, key) => {
              headers[key] = val;
            });
            value = headers;
          }
          break;

        case 'cookie':
          // Extract cookies using Hono's cookie helper
          if (param.name) {
            // Extract specific cookie
            value = getCookie(c, param.name);
          } else {
            // Extract all cookies - parse from Cookie header
            const cookieHeader = c.req.header('cookie');
            if (cookieHeader) {
              value = Object.fromEntries(
                cookieHeader.split(';').map(cookie => {
                  const [key, ...valueParts] = cookie.trim().split('=');
                  return [key, valueParts.join('=')];
                })
              );
            } else {
              value = {};
            }
          }
          break;

        case 'request':
          // Pass the raw request object
          value = c.req;
          break;

        case 'response':
        case 'context':
          // Pass the Hono context
          value = c;
          break;

        case 'current-user':
          // Extract current user from context (set by auth middleware)
          value = c.get('auth.user') || null;
          
          // Check if this route requires authentication by looking for @Auth() decorator
          // We need to check the route metadata to see if auth is required
          const routeMetadata = this.getRouteMetadataForContext(c);
          if (routeMetadata && this.isAuthRequired(routeMetadata)) {
            if (!value) {
              const authError = c.get('auth.error') || 'Authentication required';
              const { AuthenticationException } = await import('../auth/exceptions.js');
              throw new AuthenticationException(authError);
            }
          }
          break;

        case 'token':
          // Extract JWT token from context (set by auth middleware)
          value = c.get('auth.token') || null;
          break;

        case 'oauth-user':
          // Extract OAuth user from context (set by OAuth middleware)
          value = c.get('oauth.user') || null;
          break;

        case 'oauth-token':
          // Extract OAuth token from context (set by OAuth middleware)
          value = c.get('oauth.token') || null;
          break;

        case 'current-session':
          // Extract current session from context (set by session middleware)
          value = c.get('session') || null;
          break;

        case 'session-data':
          // Extract session data from context
          const session = c.get('session');
          if (session && param.metadata?.key) {
            value = session.data[param.metadata.key];
          } else if (session) {
            value = session.data;
          } else {
            value = null;
          }
          break;

        case 'csrf-token':
          // Extract CSRF token from context
          value = c.get('csrf.token') || null;
          break;

        case 'filtered-resource':
          // This would be handled by permission middleware
          value = c.get('filtered.resource') || null;
          break;

        case 'filtered-attributes':
          // This would be handled by permission middleware
          value = c.get('filtered.attributes') || [];
          break;

        case 'request-id':
          // Extract request ID from context
          const { getRequestId } = await import('../context/request-context.js');
          value = getRequestId(c);
          break;

        case 'abort-signal':
          // Extract AbortSignal from context
          const { getAbortSignal } = await import('../context/request-context.js');
          value = getAbortSignal(c);
          break;

        default:
          value = undefined;
      }

      // Validate with Zod schema if provided
      if (param.schema) {
        try {
          value = await this.validator.validate(value, param.schema);
        } catch (error) {
          // Re-throw validation errors - they'll be caught by error handler
          throw error;
        }
      }

      // Store at the correct parameter index
      extracted[param.index] = value;
    }

    return extracted;
  }

  /**
   * Merge parameters and dependencies into a single arguments array
   * Ensures each argument is placed at its correct index
   * Note: Returns a sparse array to maintain correct parameter positions
   * Uses pre-computed maxArgumentIndex from compiled metadata for performance
   */
  private mergeArguments(
    parameters: any[],
    dependencies: any[],
    paramMetadata: ParameterMetadata[],
    maxArgumentIndex?: number
  ): any[] {
    // Filter out undefined entries first
    const validParamMetadata = paramMetadata.filter(p => p !== undefined && p.index !== undefined);
    
    // Calculate indices safely
    const paramIndices = validParamMetadata.map(p => p.index);
    const maxParamIndex = paramIndices.length > 0 ? Math.max(...paramIndices) : -1;
    
    // Use pre-computed max index if available, otherwise calculate
    let maxIndex = maxArgumentIndex !== undefined && maxArgumentIndex >= 0
      ? maxArgumentIndex
      : Math.max(
          maxParamIndex,
          parameters.length - 1,
          dependencies.length - 1,
          0
        );
    
    // Ensure maxIndex is valid
    if (!Number.isFinite(maxIndex) || maxIndex < 0) {
      maxIndex = 0;
    }
    
    // Pre-allocate array with exact size needed
    const merged: any[] = new Array(maxIndex + 1);

    // Fill in parameters at their correct indices from the sparse array
    for (let i = 0; i <= maxIndex; i++) {
      if (parameters[i] !== undefined) {
        merged[i] = parameters[i];
      } else if (dependencies[i] !== undefined) {
        merged[i] = dependencies[i];
      }
    }

    return merged;
  }

  /**
   * Resolve dependencies for a route handler
   * Calls DIContainer.resolve for each dependency with appropriate scope
   */
  private async resolveDependencies(
    c: Context,
    deps: DependencyMetadata[]
  ): Promise<any[]> {
    const resolved: any[] = [];

    for (const dep of deps) {
      // Skip undefined entries (sparse array handling)
      if (!dep) continue;
      
      try {
        // Resolve the dependency with the DI container
        // Pass the context for request-scoped dependencies
        const value = await this.container.resolve(dep.provider, {
          scope: dep.scope,
          context: c
        });

        // Store at the correct parameter index
        resolved[dep.index] = value;
      } catch (error) {
        // Wrap dependency resolution errors with context
        throw new Error(
          `Failed to resolve dependency at index ${dep.index}: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    return resolved;
  }
}
