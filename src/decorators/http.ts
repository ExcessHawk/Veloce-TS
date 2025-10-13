// HTTP method decorators
import { MetadataRegistry } from '../core/metadata';
import type { HTTPMethod } from '../types';

/**
 * Controller decorator - marks a class as a controller and sets a route prefix
 * @param prefix - The route prefix for all routes in this controller (e.g., '/users')
 * @example
 * ```ts
 * @Controller('/api/users')
 * class UserController {
 *   @Get('/:id')
 *   getUser() {}
 * }
 * ```
 */
export function Controller(prefix: string = ''): ClassDecorator {
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
      middleware: []
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

      MetadataRegistry.defineRoute(target, propertyKey as string, {
        method,
        path: normalizedPath,
        middleware: [],
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
