// Dependency injection decorators
import type { Provider, Scope } from '../types';
import { MetadataRegistry } from '../core/metadata';

/**
 * @Depends decorator for dependency injection
 * Marks a parameter to be injected with a dependency from the DI container
 * 
 * @param provider - The provider (class or factory) to inject
 * @param scope - The lifecycle scope: 'singleton', 'request', or 'transient'
 * 
 * @example
 * ```typescript
 * class UserService {
 *   constructor() {}
 *   getUser(id: string) { return { id, name: 'John' }; }
 * }
 * 
 * class UserController {
 *   @Get('/users/:id')
 *   getUser(
 *     @Param('id') id: string,
 *     @Depends(UserService, 'singleton') userService: UserService
 *   ) {
 *     return userService.getUser(id);
 *   }
 * }
 * ```
 */
export function Depends<T>(provider: Provider<T>, scope: Scope = 'request'): ParameterDecorator {
  return (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    // propertyKey is undefined for constructor parameters
    if (propertyKey === undefined) {
      throw new Error('@Depends decorator can only be used on method parameters, not constructor parameters');
    }

    // Store dependency metadata
    MetadataRegistry.defineDependency(target, propertyKey as string, parameterIndex, {
      index: parameterIndex,
      provider,
      scope
    });
  };
}
