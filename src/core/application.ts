// Core application class
import { Hono } from 'hono';
import { MetadataRegistry } from './metadata';
import { DIContainer } from '../dependencies/container';
import { RouterCompiler } from './router-compiler';
import { ValidationEngine } from '../validation/validator';
import { ErrorHandler, type CustomErrorHandler } from '../errors/handler';
import { PluginManager, type Plugin } from './plugin';
import { createCorsMiddleware } from '../middleware/cors';
import { createRateLimitMiddleware } from '../middleware/rate-limit';
import { createCompressionMiddleware } from '../middleware/compression';
import type {
  FastAPIConfig,
  Class,
  RouteConfig,
  Middleware,
  CorsOptions,
  RateLimitOptions,
  CompressionOptions,
  HTTPMethod,
  Context
} from '../types';

/**
 * Main FastAPITS application class
 * 
 * Provides both decorator-based and functional API for defining routes.
 * Built on top of Hono.js for maximum performance with support for multiple runtimes.
 * 
 * @example
 * ```typescript
 * // Create a new application
 * const app = new FastAPITS({
 *   title: 'My API',
 *   version: '1.0.0',
 *   docs: true
 * });
 * 
 * // Register a controller
 * @Controller('/users')
 * class UserController {
 *   @Get('/:id')
 *   getUser(@Param('id') id: string) {
 *     return { id, name: 'John' };
 *   }
 * }
 * app.include(UserController);
 * 
 * // Or use functional API
 * app.get('/users/:id', {
 *   handler: async (c) => {
 *     const id = c.req.param('id');
 *     return { id, name: 'John' };
 *   }
 * });
 * 
 * // Start the server
 * app.listen(3000, () => {
 *   console.log('Server running on port 3000');
 * });
 * ```
 */
export class FastAPITS {
  private hono: Hono;
  private metadata: MetadataRegistry;
  private container: DIContainer;
  private validator: ValidationEngine;
  private errorHandler: ErrorHandler;
  private compiler: RouterCompiler;
  private pluginManager: PluginManager;
  private config: FastAPIConfig;
  private compiled: boolean = false;
  private globalMiddleware: Middleware[] = [];
  private groupPrefix: string = '';

  constructor(config?: FastAPIConfig) {
    this.config = {
      adapter: 'hono',
      title: 'FastAPI-TS API',
      version: '1.0.0',
      docs: true,
      ...config
    };

    // Initialize Hono instance
    this.hono = new Hono();

    // Create MetadataRegistry and DIContainer instances
    this.metadata = new MetadataRegistry();
    this.container = new DIContainer();
    this.validator = new ValidationEngine();
    this.errorHandler = new ErrorHandler();
    this.pluginManager = new PluginManager();

    // Create RouterCompiler
    this.compiler = new RouterCompiler(
      this.hono,
      this.metadata,
      this.container,
      this.validator,
      this.errorHandler
    );

    // Apply CORS configuration if provided
    if (this.config.cors) {
      if (this.config.cors === true) {
        this.useCors();
      } else {
        this.useCors(this.config.cors);
      }
    }
  }

  // ============================================================================
  // Controller Registration (Task 5.2)
  // ============================================================================

  /**
   * Register a controller class with the application
   * 
   * Extracts metadata from decorators and stores in registry.
   * The controller must be decorated with @Controller() and contain
   * methods decorated with HTTP method decorators (@Get, @Post, etc.)
   * 
   * @param controller - The controller class to register
   * 
   * @example
   * ```typescript
   * @Controller('/api/users')
   * class UserController {
   *   @Get('/')
   *   async list() {
   *     return [{ id: 1, name: 'John' }];
   *   }
   * 
   *   @Post('/')
   *   async create(@Body(UserSchema) user: InferSchema<typeof UserSchema>) {
   *     return { id: 2, ...user };
   *   }
   * }
   * 
   * app.include(UserController);
   * ```
   */
  include(controller: Class): void {
    // Get controller metadata from decorators
    const controllerMetadata = MetadataRegistry.getControllerMetadata(controller);
    
    if (controllerMetadata) {
      this.metadata.registerController(controller, controllerMetadata);
    }

    // Get all route methods from the controller
    const routeMethods = MetadataRegistry.getRouteMethods(controller);

    // Register each route
    for (const methodName of routeMethods) {
      const routeMetadata = MetadataRegistry.getRouteMetadata(
        controller.prototype,
        methodName
      );

      // Get parameter metadata separately
      const parameterMetadata = MetadataRegistry.getParameterMetadata(
        controller.prototype,
        methodName
      );

      // Get dependency metadata separately
      const dependencyMetadata = MetadataRegistry.getDependencyMetadata(
        controller.prototype,
        methodName
      );

      if (routeMetadata && routeMetadata.method && routeMetadata.path !== undefined) {
        // Combine controller prefix with route path
        const prefix = controllerMetadata?.prefix || '';
        const fullPath = this.normalizePath(prefix, routeMetadata.path);

        // Register the complete route metadata
        this.metadata.registerRoute({
          target: controller,
          propertyKey: methodName,
          method: routeMetadata.method,
          path: fullPath,
          middleware: [
            ...(controllerMetadata?.middleware || []),
            ...(routeMetadata.middleware || [])
          ],
          parameters: parameterMetadata || routeMetadata.parameters || [],
          dependencies: dependencyMetadata || routeMetadata.dependencies || [],
          responses: routeMetadata.responses || [],
          docs: routeMetadata.docs
        });
      }
    }
  }

  // ============================================================================
  // Functional API Methods (Task 5.3)
  // ============================================================================

  /**
   * Register a GET route using functional API
   * 
   * @param path - The route path (supports parameters like /users/:id)
   * @param config - Route configuration including handler, schema, middleware
   * 
   * @example
   * ```typescript
   * const UserSchema = z.object({ name: z.string(), age: z.number() });
   * 
   * app.get('/users/:id', {
   *   handler: async (c) => {
   *     const id = c.req.param('id');
   *     return { id, name: 'John', age: 30 };
   *   },
   *   schema: {
   *     params: z.object({ id: z.string() })
   *   },
   *   docs: {
   *     summary: 'Get user by ID',
   *     tags: ['users']
   *   }
   * });
   * ```
   */
  get(path: string, config: RouteConfig): void {
    this.registerFunctionalRoute('GET', path, config);
  }

  /**
   * Register a POST route using functional API
   * 
   * @param path - The route path
   * @param config - Route configuration including handler, schema, middleware
   * 
   * @example
   * ```typescript
   * const CreateUserSchema = z.object({
   *   name: z.string(),
   *   email: z.string().email()
   * });
   * 
   * app.post('/users', {
   *   handler: async (c) => {
   *     const body = await c.req.json();
   *     return { id: 1, ...body };
   *   },
   *   schema: {
   *     body: CreateUserSchema
   *   }
   * });
   * ```
   */
  post(path: string, config: RouteConfig): void {
    this.registerFunctionalRoute('POST', path, config);
  }

  /**
   * Register a PUT route
   */
  put(path: string, config: RouteConfig): void {
    this.registerFunctionalRoute('PUT', path, config);
  }

  /**
   * Register a DELETE route
   */
  delete(path: string, config: RouteConfig): void {
    this.registerFunctionalRoute('DELETE', path, config);
  }

  /**
   * Register a PATCH route
   */
  patch(path: string, config: RouteConfig): void {
    this.registerFunctionalRoute('PATCH', path, config);
  }

  /**
   * Create a route builder for chaining methods
   */
  route(path: string): RouteBuilder {
    return new RouteBuilder(this, path);
  }

  /**
   * Create a route group with a common prefix
   */
  group(prefix: string, callback: () => void): void {
    const previousPrefix = this.groupPrefix;
    this.groupPrefix = this.normalizePath(this.groupPrefix, prefix);
    
    callback();
    
    this.groupPrefix = previousPrefix;
  }

  /**
   * Internal method to register functional routes
   */
  private registerFunctionalRoute(
    method: HTTPMethod,
    path: string,
    config: RouteConfig
  ): void {
    // Apply group prefix if we're inside a group
    const fullPath = this.normalizePath(this.groupPrefix, path);

    // Create a synthetic route metadata for functional routes
    // We use a special marker class to distinguish functional routes
    const routeMetadata = {
      target: FunctionalRoute as any,
      propertyKey: `${method.toLowerCase()}_${fullPath}`,
      method,
      path: fullPath,
      middleware: config.middleware || [],
      parameters: this.extractParametersFromSchema(config.schema),
      dependencies: [],
      responses: config.responses || [],
      docs: config.docs,
      handler: config.handler // Store handler directly for functional routes
    };

    this.metadata.registerRoute(routeMetadata as any);
  }

  /**
   * Extract parameter metadata from schema config
   * For functional API, parameters start at index 0 since context is passed separately
   */
  private extractParametersFromSchema(schema?: RouteConfig['schema']): any[] {
    const parameters: any[] = [];
    let index = 0; // Start at 0 for functional API (context is passed separately)

    if (schema?.body) {
      parameters.push({
        index: index++,
        type: 'body',
        schema: schema.body,
        required: true
      });
    }

    if (schema?.query) {
      parameters.push({
        index: index++,
        type: 'query',
        schema: schema.query,
        required: false
      });
    }

    if (schema?.params) {
      parameters.push({
        index: index++,
        type: 'param',
        schema: schema.params,
        required: true
      });
    }

    if (schema?.headers) {
      parameters.push({
        index: index++,
        type: 'header',
        schema: schema.headers,
        required: false
      });
    }

    return parameters;
  }

  // ============================================================================
  // Middleware System (Task 5.4)
  // ============================================================================

  /**
   * Add global middleware to the application
   */
  use(middleware: Middleware): void {
    this.globalMiddleware.push(middleware);
    this.hono.use('*', middleware);
  }

  /**
   * Configure CORS middleware
   * Supports origin, methods, headers configuration and handles preflight requests
   */
  useCors(options?: CorsOptions): void {
    const middleware = createCorsMiddleware(options);
    this.use(middleware);
  }

  /**
   * Configure rate limiting middleware
   * Tracks requests per IP/key and returns 429 when limit exceeded
   */
  useRateLimit(options: RateLimitOptions): void {
    const middleware = createRateLimitMiddleware(options);
    this.use(middleware);
  }

  /**
   * Configure compression middleware
   * Compresses responses with gzip/brotli based on configuration
   */
  useCompression(options?: CompressionOptions): void {
    const middleware = createCompressionMiddleware(options);
    this.use(middleware);
  }

  // ============================================================================
  // Plugin System (Task 10.2)
  // ============================================================================

  /**
   * Register a plugin with the application
   * Plugins are installed during compilation in dependency order
   * @param plugin - The plugin to register
   */
  usePlugin(plugin: Plugin): void {
    this.pluginManager.register(plugin);
  }

  /**
   * Get the plugin manager instance
   * @returns The PluginManager instance
   */
  getPluginManager(): PluginManager {
    return this.pluginManager;
  }

  // ============================================================================
  // Error Handling (Task 9.3)
  // ============================================================================

  /**
   * Set a custom error handler for the application
   * This allows users to override the default error handling behavior
   * @param handler - Custom error handling function
   */
  onError(handler: CustomErrorHandler): void {
    this.errorHandler.setCustomHandler(handler);
  }

  /**
   * Get the error handler instance
   * @returns The ErrorHandler instance
   */
  getErrorHandler(): ErrorHandler {
    return this.errorHandler;
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Normalize path by combining segments and ensuring proper format
   */
  private normalizePath(...segments: string[]): string {
    const combined = segments
      .filter(s => s !== '')
      .join('/')
      .replace(/\/+/g, '/') // Remove duplicate slashes
      .replace(/\/$/, ''); // Remove trailing slash

    return combined.startsWith('/') ? combined : `/${combined}`;
  }

  /**
   * Get the underlying Hono instance
   */
  getHono(): Hono {
    return this.hono;
  }

  /**
   * Get the metadata registry
   */
  getMetadata(): MetadataRegistry {
    return this.metadata;
  }

  /**
   * Get the DI container
   */
  getContainer(): DIContainer {
    return this.container;
  }

  /**
   * Get the application configuration
   */
  getConfig(): FastAPIConfig {
    return this.config;
  }

  /**
   * Check if routes have been compiled
   */
  isCompiled(): boolean {
    return this.compiled;
  }

  /**
   * Mark routes as compiled
   */
  markCompiled(): void {
    this.compiled = true;
  }

  /**
   * Compile all registered routes into the Hono router
   * This must be called before the application can handle requests
   * Installs plugins before compiling routes
   */
  async compile(): Promise<void> {
    if (this.compiled) {
      console.warn('Routes have already been compiled. Skipping compilation.');
      return;
    }

    // Install plugins before compiling routes
    await this.pluginManager.install(this);

    // Use the RouterCompiler to process all routes
    this.compiler.compile();

    // Mark as compiled
    this.compiled = true;
  }

  /**
   * Start the server and listen on the specified port
   * Automatically compiles routes if not already compiled
   * Delegates to the configured adapter for runtime-specific server implementation
   */
  async listen(port: number, callback?: () => void): Promise<any> {
    // Compile routes if not already done
    if (!this.compiled) {
      await this.compile();
    }

    // Create and use the appropriate adapter based on configuration
    const adapter = this.createAdapter();
    
    return adapter.listen(port, callback);
  }

  /**
   * Create the appropriate adapter based on configuration
   * @private
   */
  private createAdapter() {
    const adapterType = this.config.adapter || 'hono';

    switch (adapterType) {
      case 'hono': {
        // Dynamically import to avoid circular dependencies
        const { HonoAdapter } = require('../adapters/hono');
        return new HonoAdapter(this.hono);
      }

      case 'express': {
        // Dynamically import ExpressAdapter
        const { ExpressAdapter } = require('../adapters/express');
        return new ExpressAdapter(this);
      }

      case 'native': {
        // Native adapter would use Web Standards directly
        // For now, fall back to Hono adapter
        const { HonoAdapter } = require('../adapters/hono');
        return new HonoAdapter(this.hono);
      }

      default:
        throw new Error(
          `Unknown adapter type: ${adapterType}. Supported adapters: 'hono', 'express', 'native'`
        );
    }
  }
}

/**
 * Marker class for functional routes
 */
class FunctionalRoute {}

/**
 * Route builder for chaining HTTP methods
 */
class RouteBuilder {
  constructor(
    private app: FastAPITS,
    private path: string
  ) {}

  get(config: RouteConfig): RouteBuilder {
    this.app.get(this.path, config);
    return this;
  }

  post(config: RouteConfig): RouteBuilder {
    this.app.post(this.path, config);
    return this;
  }

  put(config: RouteConfig): RouteBuilder {
    this.app.put(this.path, config);
    return this;
  }

  delete(config: RouteConfig): RouteBuilder {
    this.app.delete(this.path, config);
    return this;
  }

  patch(config: RouteConfig): RouteBuilder {
    this.app.patch(this.path, config);
    return this;
  }
}
