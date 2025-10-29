// GraphQL decorators for Veloce-TS
import 'reflect-metadata';
import type { ZodSchema } from 'zod';
import type {
  GraphQLResolverMetadata,
  GraphQLFieldMetadata,
  GraphQLArgumentMetadata,
  GraphQLOperationType
} from '../types';

// Metadata keys for reflect-metadata
const GRAPHQL_RESOLVER_KEY = Symbol('graphql:resolver');
const GRAPHQL_FIELD_KEY = Symbol('graphql:field');
const GRAPHQL_ARGS_KEY = Symbol('graphql:args');

/**
 * @Resolver decorator - Marks a class as a GraphQL resolver
 * 
 * @example
 * ```typescript
 * @Resolver()
 * class UserResolver {
 *   @Query()
 *   async getUser(@Arg('id', z.string()) id: string) {
 *     return { id, name: 'John' };
 *   }
 * }
 * ```
 */
export function Resolver(name?: string): ClassDecorator {
  return (target: any) => {
    const metadata: GraphQLResolverMetadata = {
      target,
      name: name || target.name
    };

    Reflect.defineMetadata(GRAPHQL_RESOLVER_KEY, metadata, target);
  };
}

/**
 * @GQLQuery decorator - Marks a method as a GraphQL query
 * 
 * @example
 * ```typescript
 * @GQLQuery()
 * async getUser(@Arg('id', z.string()) id: string) {
 *   return { id, name: 'John' };
 * }
 * ```
 */
export function GQLQuery(name?: string, options?: {
  description?: string;
  deprecated?: boolean;
  deprecationReason?: string;
}): MethodDecorator {
  return createFieldDecorator('query', name, options);
}

// Alias for convenience
export { GQLQuery as GraphQLQuery };

/**
 * @GQLMutation decorator - Marks a method as a GraphQL mutation
 * 
 * @example
 * ```typescript
 * @GQLMutation()
 * async createUser(@Arg('input', CreateUserSchema) input: CreateUserInput) {
 *   return { id: '1', ...input };
 * }
 * ```
 */
export function GQLMutation(name?: string, options?: {
  description?: string;
  deprecated?: boolean;
  deprecationReason?: string;
}): MethodDecorator {
  return createFieldDecorator('mutation', name, options);
}

// Alias for convenience
export { GQLMutation as GraphQLMutation };
export { GQLMutation as Mutation };

/**
 * @GQLSubscription decorator - Marks a method as a GraphQL subscription
 * 
 * @example
 * ```typescript
 * @GQLSubscription()
 * async onUserCreated() {
 *   return pubsub.asyncIterator('USER_CREATED');
 * }
 * ```
 */
export function GQLSubscription(name?: string, options?: {
  description?: string;
  deprecated?: boolean;
  deprecationReason?: string;
}): MethodDecorator {
  return createFieldDecorator('subscription', name, options);
}

// Alias for convenience
export { GQLSubscription as GraphQLSubscription };
export { GQLSubscription as Subscription };

/**
 * Helper function to create field decorators
 */
function createFieldDecorator(
  type: GraphQLOperationType,
  name?: string,
  options?: {
    description?: string;
    deprecated?: boolean;
    deprecationReason?: string;
  }
): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    const metadata: GraphQLFieldMetadata = {
      target: target.constructor,
      propertyKey: propertyKey as string,
      type,
      name: name || (propertyKey as string),
      description: options?.description,
      deprecated: options?.deprecated,
      deprecationReason: options?.deprecationReason
    };

    // Store field metadata
    const existingFields = Reflect.getMetadata(GRAPHQL_FIELD_KEY, target.constructor) || [];
    existingFields.push(metadata);
    Reflect.defineMetadata(GRAPHQL_FIELD_KEY, existingFields, target.constructor);

    // Also store on the method itself for easy access
    Reflect.defineMetadata(GRAPHQL_FIELD_KEY, metadata, target, propertyKey);
  };
}

/**
 * @Arg decorator - Marks a parameter as a GraphQL argument with validation
 * 
 * @example
 * ```typescript
 * @Query()
 * async getUser(
 *   @Arg('id', z.string().uuid()) id: string,
 *   @Arg('includeProfile', z.boolean().optional()) includeProfile?: boolean
 * ) {
 *   return { id, name: 'John' };
 * }
 * ```
 */
export function Arg<T extends ZodSchema>(
  name: string,
  schema?: T,
  options?: {
    description?: string;
    defaultValue?: any;
    nullable?: boolean;
  }
): ParameterDecorator {
  return (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    if (!propertyKey) return;
    
    const existingArgs = Reflect.getMetadata(GRAPHQL_ARGS_KEY, target, propertyKey) || [];

    const metadata: GraphQLArgumentMetadata = {
      index: parameterIndex,
      name,
      schema,
      description: options?.description,
      defaultValue: options?.defaultValue,
      nullable: options?.nullable
    };

    existingArgs[parameterIndex] = metadata;
    Reflect.defineMetadata(GRAPHQL_ARGS_KEY, existingArgs, target, propertyKey);
  };
}

/**
 * @GQLContext decorator - Injects GraphQL context into a parameter
 * 
 * @example
 * ```typescript
 * @GQLQuery()
 * async getCurrentUser(@GQLContext() ctx: GraphQLContext) {
 *   return ctx.user;
 * }
 * ```
 */
export function GQLContext(): ParameterDecorator {
  return (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    if (!propertyKey) return;
    
    const existingArgs = Reflect.getMetadata(GRAPHQL_ARGS_KEY, target, propertyKey) || [];

    const metadata: GraphQLArgumentMetadata = {
      index: parameterIndex,
      name: '__context__', // Special marker for context injection
      nullable: false
    };

    existingArgs[parameterIndex] = metadata;
    Reflect.defineMetadata(GRAPHQL_ARGS_KEY, existingArgs, target, propertyKey);
  };
}

// Alias for convenience (note: GraphQLContext type is exported from graphql module)
export { GQLContext as GraphQLCtx };

// ============================================================================
// Helper functions to retrieve metadata
// ============================================================================

/**
 * Get resolver metadata from a class
 */
export function getResolverMetadata(target: any): GraphQLResolverMetadata | undefined {
  return Reflect.getMetadata(GRAPHQL_RESOLVER_KEY, target);
}

/**
 * Get all field metadata from a resolver class
 */
export function getFieldsMetadata(target: any): GraphQLFieldMetadata[] {
  return Reflect.getMetadata(GRAPHQL_FIELD_KEY, target) || [];
}

/**
 * Get field metadata from a specific method
 */
export function getFieldMetadata(target: any, propertyKey: string): GraphQLFieldMetadata | undefined {
  return Reflect.getMetadata(GRAPHQL_FIELD_KEY, target, propertyKey);
}

/**
 * Get argument metadata from a method
 */
export function getArgumentsMetadata(target: any, propertyKey: string): GraphQLArgumentMetadata[] {
  return Reflect.getMetadata(GRAPHQL_ARGS_KEY, target, propertyKey) || [];
}

/**
 * Check if a class has resolver metadata
 */
export function hasResolverMetadata(target: any): boolean {
  return Reflect.hasMetadata(GRAPHQL_RESOLVER_KEY, target);
}

/**
 * Check if a method has field metadata
 */
export function hasFieldMetadata(target: any, propertyKey: string): boolean {
  return Reflect.hasMetadata(GRAPHQL_FIELD_KEY, target, propertyKey);
}
