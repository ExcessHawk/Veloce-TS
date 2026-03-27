// HTTP method decorators
import { MetadataRegistry } from '../core/metadata';
import type { HTTPMethod, Middleware, RateLimitOptions } from '../types';
import type { ZodSchema } from 'zod';
import { createRateLimitMiddleware } from '../middleware/rate-limit.js';

export interface ControllerOptions {
  middleware?: Middleware[];
}

/**
 * Controller decorator - marks a class as a controller and sets a route prefix
 * @param prefix - The route prefix for all routes in this controller (e.g., '/users')
 * @param options - Optional configuration including middleware
 * @example
 * ```ts
 * @Controller('/api/users')
 * class UserController {
 *   @Get('/:id')
 *   getUser() {}
 * }
 * 
 * // With middleware
 * @Controller('/api/users', { middleware: [authMiddleware] })
 * class UserController {
 *   @Get('/:id')
 *   getUser() {}
 * }
 * ```
 */
export function Controller(prefix: string = '', options?: ControllerOptions): ClassDecorator {
  return (target: any) => {
    // Normalize prefix: ensure it starts with / if not empty, and doesn't end with /
    let normalizedPrefix = prefix.trim();
    if (normalizedPrefix && !normalizedPrefix.startsWith('/')) {
      normalizedPrefix = '/' + normalizedPrefix;
    }
    if (normalizedPrefix.endsWith('/')) {
      normalizedPrefix = normalizedPrefix.slice(0, -1);
    }

    MetadataRegistry.defineController(target, {
      prefix: normalizedPrefix,
      middleware: options?.middleware || []
    });
  };
}

/**
 * Helper function to create HTTP method decorators
 */
function createMethodDecorator(method: HTTPMethod) {
  return (path: string = ''): MethodDecorator => {
    return (target: any, propertyKey: string | symbol) => {
      // Normalize path: ensure it starts with / if not empty
      let normalizedPath = path.trim();
      if (normalizedPath && !normalizedPath.startsWith('/')) {
        normalizedPath = '/' + normalizedPath;
      }

      // Check if there's middleware from @UseMiddleware decorator
      const methodMiddleware = Reflect.getMetadata('route:middleware', target, propertyKey) || [];

      MetadataRegistry.defineRoute(target, propertyKey as string, {
        method,
        path: normalizedPath,
        middleware: methodMiddleware,
        parameters: [],
        dependencies: [],
        responses: []
      });
    };
  };
}

/**
 * GET method decorator
 * @param path - The route path (e.g., '/:id' or '/list')
 * @example
 * ```ts
 * @Get('/:id')
 * getUser(@Param('id') id: string) {}
 * ```
 */
export const Get = createMethodDecorator('GET');

/**
 * POST method decorator
 * @param path - The route path
 * @example
 * ```ts
 * @Post('/')
 * createUser(@Body(UserSchema) data: User) {}
 * ```
 */
export const Post = createMethodDecorator('POST');

/**
 * PUT method decorator
 * @param path - The route path
 * @example
 * ```ts
 * @Put('/:id')
 * updateUser(@Param('id') id: string, @Body(UserSchema) data: User) {}
 * ```
 */
export const Put = createMethodDecorator('PUT');

/**
 * DELETE method decorator
 * @param path - The route path
 * @example
 * ```ts
 * @Delete('/:id')
 * deleteUser(@Param('id') id: string) {}
 * ```
 */
export const Delete = createMethodDecorator('DELETE');

/**
 * PATCH method decorator
 * @param path - The route path
 * @example
 * ```ts
 * @Patch('/:id')
 * patchUser(@Param('id') id: string, @Body(PartialUserSchema) data: Partial<User>) {}
 * ```
 */
export const Patch = createMethodDecorator('PATCH');

/**
 * ALL method decorator - responds to all HTTP methods
 * @param path - The route path
 * @example
 * ```ts
 * @All('/health')
 * health() { return { status: 'ok' }; }
 * ```
 */
export const All = createMethodDecorator('ALL');

/**
 * Override the HTTP status code returned by a route handler.
 *
 * By default every successful handler returns 200.  Use this decorator to
 * return a different code without having to reach for the raw context.
 *
 * @param statusCode - The HTTP status code to send (e.g. 201, 202, 204)
 * @example
 * ```ts
 * @Post('/')
 * @HttpCode(201)
 * create(@Body(UserSchema) body: User) {
 *   return this.service.create(body);
 * }
 * ```
 */
export function HttpCode(statusCode: number): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    const existing = MetadataRegistry.getRouteMetadata(target, propertyKey as string);
    MetadataRegistry.defineRoute(target, propertyKey as string, {
      ...existing,
      statusCode,
    });
  };
}

/**
 * Declare the Zod schema that describes the response body.
 *
 * This decorator has two effects:
 * 1. **Runtime** – the handler's return value is passed through
 *    `schema.parseAsync()` before being sent.  Unknown fields are stripped and
 *    the output is guaranteed to match the declared shape.
 * 2. **OpenAPI** – the schema is used to generate the `200` (or the
 *    `@HttpCode`-specified) response object in the generated spec.
 *
 * @param schema  - Zod schema that the response must satisfy
 * @param statusCode - Status code this schema applies to (defaults to 200)
 * @example
 * ```ts
 * const UserPublic = z.object({ id: z.string(), name: z.string() });
 *
 * @Get('/:id')
 * @ResponseSchema(UserPublic)
 * async getUser(@Param('id') id: string) {
 *   return this.db.findUser(id); // password field stripped automatically
 * }
 * ```
 */
export function ResponseSchema(schema: ZodSchema, statusCode: number = 200): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    const existing = MetadataRegistry.getRouteMetadata(target, propertyKey as string);

    // Add / replace the response entry for the given status code
    const responses = (existing?.responses ?? []).filter(
      (r: any) => r.statusCode !== statusCode,
    );
    responses.push({ statusCode, schema, description: undefined });

    MetadataRegistry.defineRoute(target, propertyKey as string, {
      ...existing,
      responseSchema: schema,
      responses,
    });
  };
}

// ---------------------------------------------------------------------------
// Per-route operational decorators
// ---------------------------------------------------------------------------

/**
 * Abort the request with **408 Request Timeout** if the handler takes longer
 * than `ms` milliseconds to respond.
 *
 * Internally this creates a middleware that races the downstream handler
 * against a timer.  It also sets a `Timeout` response header so clients
 * know the configured limit.
 *
 * @param ms      - Timeout in milliseconds
 * @param message - Optional custom error message
 *
 * @example
 * ```ts
 * @Get('/report')
 * @Timeout(10_000)           // abort after 10 s
 * async generateReport() {
 *   return await heavyQuery();
 * }
 * ```
 */
export function Timeout(ms: number, message?: string): MethodDecorator {
  const timeoutMiddleware: Middleware = async (c, next) => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(Object.assign(new Error(message ?? `Request timed out after ${ms}ms`), { name: 'TimeoutError', statusCode: 408 }));
      }, ms);
    });

    try {
      c.header('X-Timeout-Ms', String(ms));
      await Promise.race([next(), timeoutPromise]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  return (target: any, propertyKey: string | symbol) => {
    // Prepend the timeout middleware so it wraps the full handler
    const existingRoute = MetadataRegistry.getRouteMetadata(target, propertyKey as string);
    const existingReflect = Reflect.getMetadata('route:middleware', target, propertyKey) || [];

    Reflect.defineMetadata('route:middleware', [timeoutMiddleware, ...existingReflect], target, propertyKey);
    MetadataRegistry.defineRoute(target, propertyKey as string, {
      ...existingRoute,
      middleware: [timeoutMiddleware, ...(existingRoute?.middleware || [])],
    });
  };
}

/**
 * Apply rate-limiting to a single route.
 *
 * This is a per-route shorthand for `@UseMiddleware(createRateLimitMiddleware(options))`.
 * When multiple instances of the same route are called by the same client, only
 * `max` requests are allowed per `windowMs` milliseconds.
 *
 * Standard rate-limit response headers are set automatically:
 * `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.
 *
 * @param options - Rate limit configuration (max, windowMs, keyGenerator…)
 *
 * @example
 * ```ts
 * // Allow 5 login attempts per minute per IP
 * @Post('/login')
 * @RateLimit({ max: 5, windowMs: 60_000 })
 * async login(@Body(LoginSchema) body: LoginDto) {
 *   return this.authService.login(body);
 * }
 * ```
 */
export function RateLimit(options: RateLimitOptions): MethodDecorator {
  const rateLimitMw = createRateLimitMiddleware(options);

  return (target: any, propertyKey: string | symbol) => {
    const existingRoute   = MetadataRegistry.getRouteMetadata(target, propertyKey as string);
    const existingReflect = Reflect.getMetadata('route:middleware', target, propertyKey) || [];

    Reflect.defineMetadata('route:middleware', [rateLimitMw, ...existingReflect], target, propertyKey);
    MetadataRegistry.defineRoute(target, propertyKey as string, {
      ...existingRoute,
      middleware: [rateLimitMw, ...(existingRoute?.middleware || [])],
    });
  };
}
