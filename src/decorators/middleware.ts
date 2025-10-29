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
    // Store middleware in a temporary metadata that will be merged later
    // We use Reflect metadata to store it temporarily
    const existingMiddleware = Reflect.getMetadata('route:middleware', target, propertyKey) || [];
    Reflect.defineMetadata('route:middleware', [...existingMiddleware, ...middleware], target, propertyKey);
  };
}
