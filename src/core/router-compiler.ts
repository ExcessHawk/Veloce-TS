/**
 * @module veloce-ts/core/router-compiler
 * @description {@link RouterCompiler}: traduce metadatos + rutas funcionales a rutas Hono reales, aplicando
 * validación Zod, inyección de dependencias, serialización de respuestas y el manejador global de errores.
 */
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
import { BadRequestException, HTTPException } from '../errors/exceptions';
import { getLogger } from '../logging/logger';
import type { FilterManager } from '../errors/exception-filter';
import { InterceptorManager, getInterceptors, type ExecutionContext } from './interceptor-manager';
import { isSSE, getStreamContentType } from '../decorators/stream';
import { CacheManager } from '../cache/manager';
import { parseTTL } from '../cache/types';
import { AuthenticationException } from '../auth/exceptions';
import { getRequestId, getAbortSignal } from '../context/request-context';

function isAsyncGenerator(v: unknown): v is AsyncGenerator {
  return v != null && typeof (v as any)[Symbol.asyncIterator] === 'function';
}

function sseResponse(gen: AsyncGenerator): Response {
  const stream = new ReadableStream({
    async pull(controller) {
      const { value, done } = await gen.next();
      if (done) { controller.close(); return; }
      const data = typeof value === 'string' ? value : JSON.stringify(value);
      controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
    },
    cancel() { gen.return?.(undefined); },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

function streamResponse(gen: AsyncGenerator, contentType: string): Response {
  const stream = new ReadableStream({
    async pull(controller) {
      const { value, done } = await gen.next();
      if (done) { controller.close(); return; }
      const chunk = typeof value === 'string'
        ? new TextEncoder().encode(value)
        : value instanceof Uint8Array ? value
        : new TextEncoder().encode(JSON.stringify(value));
      controller.enqueue(chunk);
    },
    cancel() { gen.return?.(undefined); },
  });
  return new Response(stream, { headers: { 'Content-Type': contentType } });
}

/**
 * RouterCompiler converts metadata from decorators and functional API
 * into actual Hono routes with full validation and dependency injection
 */
export class RouterCompiler {

  constructor(
    private app: Hono,
    private metadata: MetadataRegistry,
    private container: DIContainer,
    private validator: ValidationEngine,
    private errorHandler: ErrorHandler,
    private filterManager?: FilterManager,
    private interceptorManager?: InterceptorManager
  ) {}

  /**
   * Compile all registered routes and register them with Hono
   * This is the main entry point that processes all route metadata
   */
  compile(): void {
    // Route-level middleware (e.g. the RBAC guard) runs OUTSIDE the per-route
    // handler's try/catch, so an exception thrown there bypasses createHandler's
    // error handling and Hono would turn it into a generic 500. Register a global
    // Hono error hook that funnels every uncaught error through the same
    // ErrorHandler, so an AuthorizationException from a guard maps to 403, etc.
    this.app.onError((err, c) => this.errorHandler.handle(err as Error, c));

    const routes = this.metadata.getRoutes();

    // Pre-compile all routes for performance
    const compiledRoutes = MetadataCompiler.compileAll(routes);

    for (const route of compiledRoutes) {
      const handler = this.createHandler(route);
      const path = this.normalizePath(route.path);
      const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'delete' | 'patch';

      // Register route with Hono, including any middleware
      // Note: Controller middleware is already included in route.middleware by application.ts
      const register = this.app[method].bind(this.app) as (path: string, ...handlers: any[]) => any;
      if (route.middleware && route.middleware.length > 0) {
        register(path, ...route.middleware, handler);
      } else {
        register(path, handler);
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
    // Per-route constants — resolved once at compile time, not per request
    const isFunctional = Boolean((route as any).handler);
    const cacheConfig = (route as any).cache;
    const invalidatePatterns = (route as any).cacheInvalidate;
    const responseSchema = (route as any).responseSchema;
    const statusCode = (route as any).statusCode;
    const localInterceptors = isFunctional
      ? []
      : getInterceptors(route.target, route.propertyKey);
    const sseRoute = isFunctional ? false : isSSE(route.target, route.propertyKey);
    const streamCT = isFunctional
      ? undefined
      : getStreamContentType(route.target, route.propertyKey);
    const controllerScope = isFunctional
      ? undefined
      : MetadataRegistry.getControllerMetadata(route.target)?.scope || 'singleton';

    return async (c: Context) => {
      try {
        // Store route metadata in context for auth checks
        c.set('routeMetadata', route);

        // Check if route has caching enabled
        let cacheKey: string | null = null;

        if (cacheConfig) {
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
        
        // 1. Extract and validate parameters from the request (dense arrays
        //    are precomputed at compile time — no sparse-slot guards needed)
        const args = await this.extractParameters(c, route.parametersDense);

        // 2. Resolve dependencies with the DI container
        const deps = await this.resolveDependencies(c, route.dependenciesDense);

        // 3. Merge parameters and dependencies into correct order
        const allArgs = this.mergeArguments(args, deps, route.parametersDense, route.maxArgumentIndex);

        // 4. Build the core execution function (wrapped by interceptors below)
        const execute = async (): Promise<Response> => {
          try {
            let result: any;

            // Check if this is a functional route (has handler property)
            if (isFunctional) {
              result = await (route as any).handler(c, ...allArgs);
            } else {
              // Decorator-based route - resolve controller (singleton by default,
              // configurable via @Controller('/x', { scope }) )
              const instance = await this.container.resolve(route.target, {
                scope: controllerScope,
                context: c
              });

              if (typeof instance[route.propertyKey] !== 'function') {
                throw new Error(`Method ${route.propertyKey} not found on controller ${route.target.name}`);
              }

              result = await instance[route.propertyKey](...allArgs);
            }

            // Cache the result if caching is enabled
            if (cacheConfig && cacheKey) {
              if (!cacheConfig.condition || cacheConfig.condition(result)) {
                const ttl = parseTTL(cacheConfig.ttl);
                await CacheManager.set(cacheKey, result, ttl, cacheConfig.store);
              }
            }

            // Handle cache invalidation if configured
            if (invalidatePatterns && Array.isArray(invalidatePatterns)) {
              const params = c.req.param();
              for (const pattern of invalidatePatterns) {
                let resolvedPattern = pattern;
                if (params) {
                  for (const [key, value] of Object.entries(params)) {
                    resolvedPattern = resolvedPattern.replace(`{${key}}`, String(value));
                  }
                }
                await CacheManager.invalidate(resolvedPattern);
              }
            }

            // 5a. SSE / Stream — return streaming response directly (skip serializer)
            if (isAsyncGenerator(result)) {
              if (sseRoute) {
                return sseResponse(result);
              }
              if (streamCT) {
                return streamResponse(result, streamCT);
              }
            }

            // 5b. Validate / strip response with @ResponseSchema if present
            if (responseSchema) {
              try {
                result = await responseSchema.parseAsync(result);
              } catch (validationError) {
                // The handler produced output that violates its own contract —
                // fail loudly server-side, return a generic 500 to the client
                getLogger().error(
                  'Response schema validation failed',
                  validationError instanceof Error ? validationError : undefined,
                  {
                    method: route.method,
                    path: route.path,
                    handler: route.propertyKey,
                  }
                );
                throw new HTTPException(500, 'Response validation failed');
              }
            }

            // 5c. Apply @HttpCode status before serialising
            if (statusCode) {
              c.status(statusCode as any);
            }

            // 5d. Serialize and return the response
            return this.serializeResponse(c, result);
          } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            // Try exception filters first
            if (this.filterManager) {
              const filtered = await this.filterManager.handle(error, c);
              if (filtered) return filtered;
            }
            // Fall back to default error handler
            return await this.handleError(c, error);
          }
        };

        // 4b. Wrap with interceptor chain
        const execCtx: ExecutionContext = {
          request: c.req.raw,
          handlerName: route.propertyKey,
          controllerName: route.target?.name ?? 'FunctionalRoute',
        };

        if (this.interceptorManager) {
          return this.interceptorManager.execute(localInterceptors, execute, execCtx);
        }
        return execute();
      } catch (error) {
        // Outer catch: errors from parameter extraction / dependency resolution
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
          // Extract query parameters; schema validation happens once in the
          // generic validator pass below (throws ValidationException → 422)
          if (param.name) {
            value = c.req.query(param.name);
          } else {
            value = c.req.query();
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
          value = getRequestId(c);
          break;

        case 'abort-signal':
          // Extract AbortSignal from context
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
    // Use pre-computed max index when available; only recompute as fallback
    let maxIndex: number;
    if (maxArgumentIndex !== undefined && maxArgumentIndex >= 0) {
      maxIndex = maxArgumentIndex;
    } else {
      let maxParamIndex = -1;
      for (const p of paramMetadata) {
        if (p !== undefined && p.index !== undefined && p.index > maxParamIndex) {
          maxParamIndex = p.index;
        }
      }
      maxIndex = Math.max(maxParamIndex, parameters.length - 1, dependencies.length - 1, 0);
    }

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
