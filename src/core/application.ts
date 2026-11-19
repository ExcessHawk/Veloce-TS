/**
 * @module veloce-ts/core/application
 * @description {@link VeloceTS} class: server bootstrap, controller/functional-route registration,
 * global middleware (CORS, rate limit, compression), plugins, and error handling delegated to {@link ErrorHandler}.
 */
import { Hono } from 'hono';
import { bodyLimit as honoBodyLimit } from 'hono/body-limit';
import { matchedRoutes } from 'hono/route';
import { MetadataRegistry, type ClassAccessMetadata } from './metadata.js';
import { PayloadTooLargeException } from '../errors/exceptions.js';
import type { ServerInstance } from '../adapters/base.js';
import { DIContainer } from '../dependencies/container.js';
import { RouterCompiler, toHonoPath } from './router-compiler.js';
import { ValidationEngine } from '../validation/validator.js';
import { ErrorHandler, type CustomErrorHandler } from '../errors/handler.js';
import { PluginManager, type Plugin } from './plugin.js';
import { FilterManager, type ExceptionFilter } from '../errors/exception-filter.js';
import { InterceptorManager, type Interceptor } from './interceptor-manager.js';
import { createCorsMiddleware } from '../middleware/cors.js';
import { createRateLimitMiddleware } from '../middleware/rate-limit.js';
import { createCompressionMiddleware } from '../middleware/compression.js';
import { createTimeoutMiddleware } from '../middleware/timeout.js';
import { getLogger } from '../logging/index.js';
import { deprecate } from '../logging/deprecation.js';
import { hasResolverMetadata, getResolverMetadata, getFieldsMetadata as getGQLFieldsMetadata } from '../decorators/graphql.js';
import { hasEventListeners, getEventListeners } from '../decorators/events.js';
import { EventBus, globalEvents } from '../events/index.js';
import type {
  VeloceTSConfig,
  Class,
  RouteConfig,
  RouteSchemas,
  Middleware,
  CorsOptions,
  RateLimitOptions,
  CompressionOptions,
  HTTPMethod,
  Context,
  RouteMetadata,
  UseMiddlewareOptions
} from '../types/index.js';

/** Default maximum request body size: 1 MiB. Override with `bodyLimit`. */
const DEFAULT_BODY_LIMIT_BYTES = 1_048_576;

/**
 * Main VeloceTS application class
 *
 * Provides both decorator-based and functional API for defining routes.
 * Built on top of Hono.js for maximum performance with support for multiple runtimes.
 * 
 * @example
 * ```typescript
 * // Create a new application
 * const app = new VeloceTS({
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
export class VeloceTS {
  private hono: Hono;
  private metadata: MetadataRegistry;
  private container: DIContainer;
  private validator: ValidationEngine;
  private errorHandler: ErrorHandler;
  private compiler: RouterCompiler;
  private pluginManager: PluginManager;
  private config: VeloceTSConfig;
  private compiled: boolean = false;
  private globalMiddleware: Middleware[] = [];
  /** `afterPlugins` middleware, held until every plugin has installed its own. */
  private lateMiddleware: Array<{ path: string; middleware: Middleware }> = [];
  /** Per-route body limits, keyed by `METHOD path` (Hono path syntax). */
  private routeBodyLimits = new Map<string, number>();
  private groupPrefix: string = '';
  private filterManager = new FilterManager();
  private interceptorManager = new InterceptorManager();
  private shutdownHandlers: Array<(signal: string) => Promise<void>> = [];
  private _shutdownTimeout = 30_000;
  private shutdownSignalsRegistered = false;

  /** Classes carrying `@On` methods, subscribed during compile(). */
  private eventListenerClasses: Class[] = [];
  /** Active subscriptions, so shutdown() can detach them again. */
  private eventSubscriptions: Array<{ event: string; handler: (payload: any) => any }> = [];
  private eventBus: EventBus;

  constructor(config?: VeloceTSConfig) {
    this.config = {
      adapter: 'hono',
      title: 'Veloce-TS API',
      version: '1.0.0',
      docs: true,
      ...config
    };

    // Defaults to the global bus, so `@On` listeners and `globalEvents.emit()`
    // reach each other. Pass one explicitly to isolate an app (tests, mainly).
    this.eventBus = this.config.eventBus ?? globalEvents;

    // Initialize Hono instance
    this.hono = new Hono();

    // Reject oversized request bodies before any handler reads them.
    // Without a limit, every @Body route will buffer whatever the client sends.
    // The limit is the route's own (`@BodyLimit` / `bodyLimit`) when it declares
    // one, otherwise the application-wide value.
    this.hono.use('*', this.createBodyLimitMiddleware());

    // Create MetadataRegistry and DIContainer instances
    this.metadata = new MetadataRegistry();
    this.container = new DIContainer();
    this.validator = new ValidationEngine();
    this.errorHandler = new ErrorHandler(undefined, {
      errorResponseFormat: this.config.errorResponseFormat,
    });
    this.pluginManager = new PluginManager();

    // Create RouterCompiler
    this.compiler = new RouterCompiler(
      this.hono,
      this.metadata,
      this.container,
      this.validator,
      this.errorHandler,
      this.filterManager,
      this.interceptorManager
    );

    // Apply CORS configuration if provided
    if (this.config.cors) {
      if (this.config.cors === true) {
        this.useCors();
      } else {
        this.useCors(this.config.cors);
      }
    }

    // Register plugins passed through the config (previously accepted and ignored)
    for (const plugin of this.config.plugins ?? []) {
      this.usePlugin(plugin);
    }
  }

  /**
   * Mount the OpenAPI plugin according to `VeloceTSConfig.docs`.
   * Skipped when the application already registers its own `openapi` plugin.
   */
  private registerDocsPlugin(): void {
    if (this.pluginManager.getPlugin('openapi')) {
      return;
    }

    const docsConfig = typeof this.config.docs === 'object' ? this.config.docs : {};

    // Imported lazily and synchronously via a thin wrapper plugin so the
    // constructor stays synchronous and OpenAPI stays out of the hot path for
    // apps that disable docs.
    const self = this;
    this.usePlugin({
      name: 'openapi',
      version: '1.0.0',
      async install(app) {
        const { OpenAPIPlugin } = await import('../plugins/openapi.js');
        const plugin = new OpenAPIPlugin({
          title: self.config.title,
          version: self.config.version,
          description: self.config.description,
          path: docsConfig.openapi ?? '/openapi.json',
          docsPath: docsConfig.path ?? '/docs',
        });
        await plugin.install(app);
      },
    });
  }

  // ============================================================================
  // Controller Registration
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
    // If this is a @Resolver class, register it into the GraphQL metadata registry
    if (hasResolverMetadata(controller)) {
      const resolverMeta = getResolverMetadata(controller);
      if (resolverMeta) {
        this.metadata.registerGraphQLResolver(resolverMeta);
        const fields = getGQLFieldsMetadata(controller);
        for (const field of fields) {
          this.metadata.registerGraphQLField(field);
        }
      }
      return;
    }

    // Event listeners are subscribed at compile() time: resolving them needs the
    // DI container and is async, while include() is not.
    if (hasEventListeners(controller)) {
      this.eventListenerClasses.push(controller);
      // A class may be both a listener and a controller, so fall through.
    }

    // If this is a WebSocket gateway, register it and stop — it has no HTTP routes
    if (MetadataRegistry.hasWebSocketMetadata(controller)) {
      const wsMetadata = MetadataRegistry.getWebSocketMetadata(controller);
      if (wsMetadata?.path) {
        this.metadata.registerWebSocket(wsMetadata as any);
      }
      return;
    }

    // Get controller metadata from decorators
    const controllerMetadata = MetadataRegistry.getControllerMetadata(controller);

    if (controllerMetadata) {
      this.metadata.registerController(controller, controllerMetadata);
    }

    // Access rules declared on the class itself (@Auth / @Roles / @Public on
    // the controller). They are the default for every route in it.
    const classAccess = MetadataRegistry.getClassAccess(controller);

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

        // Register the complete route metadata.
        // Spread routeMetadata first so that decorator-set fields (e.g. statusCode,
        // responseSchema) are preserved, then override the fields we compute here.
        this.metadata.registerRoute({
          ...routeMetadata,
          ...this.resolveRouteAccess(routeMetadata, classAccess),
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

  /**
   * Combine a route's own access metadata with its controller's.
   *
   * - A route marked `@Public()` inherits nothing.
   * - Otherwise each rule (`auth`, `roles`, `permissions`, `minimumRole`) falls
   *   back to the class-level one when the method does not declare its own, so
   *   a method-level `@Roles` overrides the class-level `@Roles`.
   * - A `@Public()` class makes its undecorated routes public.
   */
  private resolveRouteAccess(
    route: Partial<RouteMetadata>,
    classAccess: ClassAccessMetadata
  ): Partial<RouteMetadata> {
    if (route.public) {
      return { public: true };
    }

    const access: Partial<RouteMetadata> = {
      auth: route.auth ?? classAccess.auth,
      roles: route.roles ?? classAccess.roles,
      permissions: route.permissions ?? classAccess.permissions,
      minimumRole: route.minimumRole ?? classAccess.minimumRole,
    };

    const decided = access.auth || access.roles || access.permissions || access.minimumRole;
    if (!decided && classAccess.public) {
      access.public = true;
    }
    return access;
  }

  // ============================================================================
  // Functional API Methods
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
  get<S extends RouteSchemas>(path: string, config: RouteConfig<S>): void {
    this.registerFunctionalRoute('GET', path, config as RouteConfig);
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
  post<S extends RouteSchemas>(path: string, config: RouteConfig<S>): void {
    this.registerFunctionalRoute('POST', path, config as RouteConfig);
  }

  /**
   * Register a PUT route
   */
  put<S extends RouteSchemas>(path: string, config: RouteConfig<S>): void {
    this.registerFunctionalRoute('PUT', path, config as RouteConfig);
  }

  /**
   * Register a DELETE route
   */
  delete<S extends RouteSchemas>(path: string, config: RouteConfig<S>): void {
    this.registerFunctionalRoute('DELETE', path, config as RouteConfig);
  }

  /**
   * Register a PATCH route
   */
  patch<S extends RouteSchemas>(path: string, config: RouteConfig<S>): void {
    this.registerFunctionalRoute('PATCH', path, config as RouteConfig);
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

    // Build middleware list — prepend timeout wrapper when config.timeout is set
    const middleware: Middleware[] = [];
    if (config.timeout) {
      middleware.push(createTimeoutMiddleware(config.timeout));
    }
    middleware.push(...(config.middleware || []));

    const routeMetadata = {
      target: FunctionalRoute as any,
      propertyKey: `${method.toLowerCase()}_${fullPath}`,
      method,
      path: fullPath,
      middleware,
      parameters: this.extractParametersFromSchema(config.schema),
      dependencies: [],
      responses: config.responses || [],
      docs: config.docs,
      cache: config.cache,
      public: config.public,
      bodyLimit: config.bodyLimit,
      handler: config.handler
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
  // Middleware System
  // ============================================================================

  /**
   * Add global middleware to the application.
   *
   * @example
   * ```ts
   * app.use(mw);                                 // every request, before plugins
   * app.use('/api/admin/*', mw);                 // only under a path
   * app.use(mw, { phase: 'afterPlugins' });      // after auth/RBAC/session middleware
   * app.use('/api/*', mw, { phase: 'afterPlugins' });
   * ```
   *
   * `afterPlugins` middleware is attached during `compile()`, once every plugin
   * has installed its own, so it can read `auth.user` and friends. See
   * {@link MiddlewarePhase}.
   */
  use(middleware: Middleware, options?: UseMiddlewareOptions): void;
  use(path: string, middleware: Middleware, options?: UseMiddlewareOptions): void;
  use(
    pathOrMiddleware: string | Middleware,
    middlewareOrOptions?: Middleware | UseMiddlewareOptions,
    maybeOptions?: UseMiddlewareOptions
  ): void {
    const hasPath = typeof pathOrMiddleware === 'string';
    const path = hasPath ? pathOrMiddleware : '*';
    const middleware = (hasPath ? middlewareOrOptions : pathOrMiddleware) as Middleware;
    const options = (hasPath ? maybeOptions : middlewareOrOptions) as UseMiddlewareOptions | undefined;

    if (typeof middleware !== 'function') {
      throw new TypeError('app.use() expects a middleware function');
    }

    this.globalMiddleware.push(middleware);

    // Once compiled the plugin middleware is already in place, so a late
    // registration is simply "now".
    if (options?.phase === 'afterPlugins' && !this.compiled) {
      this.lateMiddleware.push({ path, middleware });
      return;
    }

    this.hono.use(path, middleware);
  }

  /**
   * Body-size guard mounted first in the pipeline. Picks the limit of the route
   * that will handle the request when it declares one, the application-wide
   * limit otherwise. A limit of 0 disables the check.
   */
  private createBodyLimitMiddleware(): Middleware {
    const globalLimit = this.config.bodyLimit ?? DEFAULT_BODY_LIMIT_BYTES;
    const guards = new Map<number, Middleware>();

    const guardFor = (maxSize: number): Middleware => {
      let guard = guards.get(maxSize);
      if (!guard) {
        guard = honoBodyLimit({
          maxSize,
          onError: () => {
            throw new PayloadTooLargeException(
              `Request body exceeds the ${maxSize} byte limit`
            );
          },
        });
        guards.set(maxSize, guard);
      }
      return guard;
    };

    return async (c, next) => {
      let limit = globalLimit;

      if (this.routeBodyLimits.size > 0) {
        // Hono resolves every handler that matches the request up front, so the
        // route that will answer is already known here.
        for (const matched of matchedRoutes(c)) {
          const override = this.routeBodyLimits.get(`${matched.method} ${matched.path}`);
          if (override !== undefined) {
            limit = override;
            break;
          }
        }
      }

      if (limit <= 0) {
        return next();
      }
      return guardFor(limit)(c, next);
    };
  }

  /** Index the per-route body limits so the guard can find them by matched route. */
  private indexRouteBodyLimits(): void {
    this.routeBodyLimits.clear();
    for (const route of this.metadata.getRoutes()) {
      if (typeof route.bodyLimit === 'number') {
        this.routeBodyLimits.set(`${route.method} ${toHonoPath(route.path)}`, route.bodyLimit);
      }
    }
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
    // A limiter keyed on the user has to run after the auth middleware, which
    // plugins attach during compile(); an IP limiter runs as early as possible
    // so it also shields the auth layer.
    const needsUser = options.keyBy === 'user' || options.keyBy === 'user-or-ip';
    const phase = options.phase ?? (needsUser && !options.keyGenerator ? 'afterPlugins' : 'early');
    this.use(middleware, { phase });
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
  // Plugin System
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
  // Error Handling
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
  // Exception Filters
  // ============================================================================

  useFilter(filter: ExceptionFilter): this {
    this.filterManager.register(filter);
    return this;
  }

  getFilterManager(): FilterManager {
    return this.filterManager;
  }

  // ============================================================================
  // Interceptors
  // ============================================================================

  useInterceptor(interceptor: Interceptor): this {
    this.interceptorManager.addGlobal(interceptor);
    return this;
  }

  getInterceptorManager(): InterceptorManager {
    return this.interceptorManager;
  }

  // ============================================================================
  // Graceful Shutdown
  // ============================================================================

  onShutdown(handler: (signal: string) => Promise<void>): this {
    this.shutdownHandlers.push(handler);
    return this;
  }

  setShutdownTimeout(ms: number): this {
    this._shutdownTimeout = ms;
    return this;
  }

  private async runShutdownHandlers(signal: string): Promise<void> {
    const logger = getLogger().child({ component: 'app' });
    const handlers = [...this.shutdownHandlers].reverse();
    for (const handler of handlers) {
      try {
        await handler(signal);
      } catch (error) {
        // One failing handler must not stop the rest, but never fail silently
        logger.error('Shutdown handler failed', error as Error);
      }
    }
  }

  /**
   * Single SIGTERM/SIGINT registration: close the server (stop accepting
   * connections), then run onShutdown handlers under the shutdown timeout.
   */
  private registerShutdownSignals(): void {
    if (typeof process === 'undefined' || this.shutdownSignalsRegistered) return;
    this.shutdownSignalsRegistered = true;
    const shutdown = async (signal: string) => {
      const logger = getLogger().child({ component: 'app' });
      logger.info(`Received ${signal}, starting graceful shutdown...`);

      const work = async () => {
        if (this.serverInstance && typeof this.serverInstance.close === 'function') {
          try {
            await Promise.resolve(this.serverInstance.close());
            logger.info('Server closed gracefully');
          } catch (error) {
            logger.error('Error closing server during shutdown', error as Error);
          }
        }
        await this.runShutdownHandlers(signal);
        try {
          await this.pluginManager.stop(this);
        } catch (error) {
          logger.error('Plugin teardown failed during shutdown', error as Error);
        }
      };

      // Exit non-zero when the drain timed out or threw, so a supervisor
      // (systemd, Kubernetes, PM2) can tell a clean stop from a truncated one.
      let exitCode = 0;
      await Promise.race([
        work(),
        new Promise<void>((_, rej) =>
          setTimeout(() => rej(new Error('Shutdown timeout')), this._shutdownTimeout)
        ),
      ]).catch(error => {
        exitCode = 1;
        logger.error('Graceful shutdown did not complete', error as Error);
      }).finally(() => process.exit(exitCode));
    };
    process.once('SIGTERM', () => shutdown('SIGTERM'));
    process.once('SIGINT',  () => shutdown('SIGINT'));
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
   * The running server, or `null` before `listen()`.
   *
   * Plugins that must reach the underlying server — such as attaching a
   * WebSocket upgrade listener on Node — should read this from `onStart()`,
   * which runs once the server is accepting connections. `raw` carries the
   * runtime's own server object.
   */
  getServer(): ServerInstance | null {
    return this.serverInstance;
  }

  /**
   * The application's event bus — the one `@On` listeners are attached to.
   * Defaults to the `globalEvents` singleton.
   */
  getEventBus(): EventBus {
    return this.eventBus;
  }

  /**
   * Resolve every class carrying `@On` methods and attach its handlers.
   *
   * Subscriptions are recorded so `shutdown()` can detach them: listeners on the
   * global bus otherwise survive the app that registered them, and a test suite
   * creating several apps would fire each event into all of them.
   */
  private async subscribeEventListeners(): Promise<void> {
    for (const listenerClass of this.eventListenerClasses) {
      const instance = await this.container.resolve<any>(listenerClass, {
        scope: MetadataRegistry.getControllerMetadata(listenerClass)?.scope ?? 'singleton',
      });

      for (const { event, propertyKey, once } of getEventListeners(listenerClass)) {
        const method = instance[propertyKey];
        if (typeof method !== 'function') {
          throw new Error(
            `@On('${event}') refers to ${listenerClass.name}.${propertyKey}, which is not a method.`
          );
        }

        const handler = (payload: any) => method.call(instance, payload);
        if (once) {
          this.eventBus.once(event, handler);
        } else {
          this.eventBus.on(event, handler);
        }
        this.eventSubscriptions.push({ event, handler });
      }
    }
  }

  /** Detach every `@On` subscription this app made. */
  private unsubscribeEventListeners(): void {
    for (const { event, handler } of this.eventSubscriptions) {
      this.eventBus.off(event, handler);
    }
    this.eventSubscriptions = [];
  }

  /**
   * Get a `fetch(request, env, ctx)` handler bound to this app — the export
   * shape serverless/edge runtimes expect instead of `listen()`. This is the
   * deploy path for **Cloudflare Workers** (and any other fetch-per-request
   * runtime): `listen()` throws there since Workers never accept an incoming
   * TCP connection to bind a port to.
   *
   * Auto-compiles routes on first call, same as `listen()`.
   *
   * @example Cloudflare Workers entrypoint
   * ```ts
   * // worker.ts
   * const app = new VeloceTS({ title: 'My API' });
   * app.get('/hello', { handler: () => ({ message: 'hi' }) });
   *
   * export default {
   *   fetch: await app.getFetchHandler(),
   * };
   * ```
   *
   * Works the same way locally with `Bun.serve({ fetch: await app.getFetchHandler() })`
   * or Deno's `Deno.serve(await app.getFetchHandler())` if you want to bypass
   * the `listen()` adapter selection entirely.
   */
  async getFetchHandler(): Promise<Hono['fetch']> {
    if (!this.compiled) {
      await this.compile();
    }
    return this.hono.fetch.bind(this.hono);
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
   * Get the router compiler
   */
  getCompiler(): RouterCompiler {
    return this.compiler;
  }

  /**
   * Get the application configuration
   */
  getConfig(): VeloceTSConfig {
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

    // `docs` mounts the OpenAPI plugin, unless the app registered its own.
    // Deferred to compile() (rather than the constructor) so a manually
    // registered OpenAPIPlugin always wins instead of colliding with this one.
    if (this.config.docs) {
      this.registerDocsPlugin();
    }

    // Install plugins before compiling routes
    await this.pluginManager.install(this);

    // Plugins have attached their own global middleware (auth, RBAC, session…):
    // attach the application's `afterPlugins` middleware behind it.
    for (const { path, middleware } of this.lateMiddleware) {
      this.hono.use(path, middleware);
    }
    this.lateMiddleware = [];

    // Every plugin is installed, so the route registry is complete: let plugins
    // inspect it (auth/RBAC inject their guards here).
    await this.pluginManager.beforeCompile(this);

    this.indexRouteBodyLimits();

    // Subscribe @On listeners. After plugin install, so a listener can inject
    // anything a plugin registered in the container.
    await this.subscribeEventListeners();

    if (this.errorHandler.exposesDetailByOmission()) {
      deprecate(
        'error-detail-by-omission',
        `Unexpected errors include their message and stack trace in the response because NODE_ENV is "${process.env.NODE_ENV ?? ''}" ` +
        '(anything other than "production"). In v4.0.0 that detail is only sent when NODE_ENV is "development" or "test". ' +
        'Set NODE_ENV explicitly.'
      );
    }

    // Use the RouterCompiler to process all routes
    this.compiler.compile();

    // Mark as compiled
    this.compiled = true;

    // Register SIGTERM/SIGINT handlers for onShutdown callbacks
    this.registerShutdownSignals();
  }

  private serverInstance: ServerInstance | null = null;

  /**
   * Start the server and listen on the specified port
   * Automatically compiles routes if not already compiled
   * Delegates to the configured adapter for runtime-specific server implementation
   * 
   * @returns Server instance with close() method for graceful shutdown
   */
  async listen(port: number, callback?: () => void): Promise<any> {
    // Compile routes if not already done
    if (!this.compiled) {
      await this.compile();
    }

    // Create and use the appropriate adapter based on configuration
    const adapter = await this.createAdapter();
    
    this.serverInstance = await adapter.listen(port, callback);

    // Plugin onStart hooks run once the server is accepting connections
    await this.pluginManager.start(this);

    // Signal handlers are registered once in compile() via registerShutdownSignals()
    return this.serverInstance;
  }

  /**
   * Gracefully shutdown the server
   */
  /**
   * Programmatic shutdown (as opposed to the SIGTERM/SIGINT path in
   * registerShutdownSignals): closes the server, then runs onShutdown
   * handlers and plugin onStop hooks — the same teardown a signal triggers,
   * minus the shutdown timeout race and process.exit.
   */
  async shutdown(): Promise<void> {
    if (this.serverInstance && typeof this.serverInstance.close === 'function') {
      await Promise.resolve(this.serverInstance.close());
      this.serverInstance = null;
    }
    this.unsubscribeEventListeners();
    await this.runShutdownHandlers('manual');
    await this.pluginManager.stop(this);
  }

  /**
   * Create the appropriate adapter based on configuration
   * @private
   */
  private async createAdapter() {
    const adapterType = this.config.adapter || 'hono';

    switch (adapterType) {
      case 'hono': {
        const { HonoAdapter } = await import('../adapters/hono.js');
        return new HonoAdapter(this.hono);
      }

      case 'express': {
        const { ExpressAdapter } = await import('../adapters/express.js');
        return new ExpressAdapter(this);
      }

      case 'native': {
        const { HonoAdapter } = await import('../adapters/hono.js');
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
    private app: VeloceTS,
    private path: string
  ) {}

  get<S extends RouteSchemas>(config: RouteConfig<S>): RouteBuilder {
    this.app.get(this.path, config);
    return this;
  }

  post<S extends RouteSchemas>(config: RouteConfig<S>): RouteBuilder {
    this.app.post(this.path, config);
    return this;
  }

  put<S extends RouteSchemas>(config: RouteConfig<S>): RouteBuilder {
    this.app.put(this.path, config);
    return this;
  }

  delete<S extends RouteSchemas>(config: RouteConfig<S>): RouteBuilder {
    this.app.delete(this.path, config);
    return this;
  }

  patch<S extends RouteSchemas>(config: RouteConfig<S>): RouteBuilder {
    this.app.patch(this.path, config);
    return this;
  }
}
