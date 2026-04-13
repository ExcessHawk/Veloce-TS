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
    if (propertyKey === undefined) {
      // Constructor parameter — store on prototype with key 'constructor'
      MetadataRegistry.defineDependency(target.prototype, 'constructor', parameterIndex, {
        index: parameterIndex,
        provider,
        scope,
      });
    } else {
      // Method parameter
      MetadataRegistry.defineDependency(target, propertyKey as string, parameterIndex, {
        index: parameterIndex,
        provider,
        scope
      });
    }
  };
}

/**
 * @Inject decorator for constructor dependency injection
 * Marks a constructor parameter to be injected with a dependency from the DI container
 *
 * @param provider - The provider (class, token, or symbol) to inject
 * @param scope - The lifecycle scope: 'singleton', 'request', or 'transient'
 *
 * @example
 * ```typescript
 * @Controller('/users')
 * class UserController {
 *   constructor(
 *     @InjectDB() private db: DrizzleDB,
 *     @Inject(UserService) private userService: UserService,
 *   ) {}
 * }
 * ```
 */
export function Inject<T>(provider: Provider<T>, scope: Scope = 'singleton'): ParameterDecorator {
  return (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    if (propertyKey === undefined) {
      // Constructor parameter
      MetadataRegistry.defineDependency(target.prototype, 'constructor', parameterIndex, {
        index: parameterIndex,
        provider,
        scope,
      });
    } else {
      // Method parameter (fallback — same as @Depends)
      MetadataRegistry.defineDependency(target, propertyKey as string, parameterIndex, {
        index: parameterIndex,
        provider,
        scope,
      });
    }
  };
}
