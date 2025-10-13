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
   * Integrates parameter extraction, validation, dependency injection, and error handling
   */
  private createHandler(route: CompiledRouteMetadata): (c: Context) => Promise<any> {
    return async (c: Context) => {
      try {
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
          result = await instance[route.propertyKey](...allArgs);
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
          // Extract query parameters
          if (param.name) {
            // Extract specific query parameter
            value = c.req.query(param.name);
          } else {
            // Extract all query parameters
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
    // Use pre-computed max index if available, otherwise calculate
    const maxIndex = maxArgumentIndex !== undefined
      ? maxArgumentIndex
      : Math.max(
          paramMetadata.length > 0 ? Math.max(...paramMetadata.map(p => p.index)) : -1,
          parameters.length - 1,
          dependencies.length - 1
        );
    
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
