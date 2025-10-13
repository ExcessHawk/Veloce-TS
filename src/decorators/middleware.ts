// Middleware decorators
import type { Middleware } from '../types';

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
  // Implementation in task 16
  return (target: any, propertyKey: string | symbol) => {};
}
