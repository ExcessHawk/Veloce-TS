// Middleware decorators
import type { Middleware } from '../types';
import { MetadataRegistry } from '../core/metadata';

/**
 * UseMiddleware decorator - applies middleware to a specific route
 * 
 * Middleware functions are executed before the route handler.
 * Multiple middleware can be chained and will execute in order.
 * 
 * @param middleware - One or more middleware functions to apply
 * 
 * @example
 * ```typescript
 * const authMiddleware: Middleware = async (c, next) => {
 *   const token = c.req.header('authorization');
 *   if (!token) {
 *     return c.json({ error: 'Unauthorized' }, 401);
 *   }
 *   await next();
 * };
 * 
 * class UserController {
 *   @Get('/profile')
 *   @UseMiddleware(authMiddleware)
 *   getProfile() {
 *     return { name: 'John', email: 'john@example.com' };
 *   }
 * }
 * ```
 */
export function UseMiddleware(...middleware: Middleware[]): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    // 1. Keep Reflect metadata so that @Get/@Post can pick it up when they run AFTER this decorator
    const existingMiddleware = Reflect.getMetadata('route:middleware', target, propertyKey) || [];
    Reflect.defineMetadata('route:middleware', [...existingMiddleware, ...middleware], target, propertyKey);

    // 2. Also update MetadataRegistry directly so the middleware is not lost when
    //    @UseMiddleware runs AFTER the HTTP method decorator (bottom-up execution order).
    //    MetadataRegistry.defineRoute merges middleware arrays, so this is idempotent.
    const existingRoute = MetadataRegistry.getRouteMetadata(target, propertyKey as string);
    MetadataRegistry.defineRoute(target, propertyKey as string, {
      ...existingRoute,
      middleware: [
        ...(existingRoute?.middleware || []),
        ...middleware,
      ],
    });
  };
}
