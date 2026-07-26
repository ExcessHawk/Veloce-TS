// Return-type metadata for GraphQL resolver methods.
//
// The @GQLQuery/@GQLMutation decorators do not carry return-type information
// on their own (GraphQLFieldMetadata.returnType is optional and never set by
// them), so this module provides an explicit @Returns decorator that resolver
// authors can stack on a method to declare its GraphQL return type — either
// as a raw SDL type reference (e.g. 'String', '[Int!]', 'User') or as a Zod
// schema. ZodObject schemas are emitted as named GraphQL object types by the
// schema builder.
import 'reflect-metadata';
import type { ZodSchema } from 'zod';

const GRAPHQL_RETURN_KEY = Symbol('graphql:return');

/**
 * Options for the @Returns decorator.
 */
export interface ReturnsOptions {
  /**
   * GraphQL object type name to use when the return type is described by a
   * ZodObject schema. Defaults to the capitalized field name.
   */
  name?: string;
  /** Whether the field may resolve to null (default: false → emitted with `!`). */
  nullable?: boolean;
  /** Whether the field returns a list of the declared type. */
  list?: boolean;
}

/**
 * Normalized return-type metadata stored on a resolver method.
 */
export interface GraphQLReturnTypeMetadata extends ReturnsOptions {
  /** Raw SDL type reference (used verbatim, e.g. 'String', '[Int!]', 'User'). */
  type?: string;
  /** Zod schema describing the return shape. */
  schema?: ZodSchema;
}

/**
 * @Returns decorator - Declares the GraphQL return type of a resolver method.
 *
 * @example
 * ```typescript
 * const UserSchema = z.object({ id: z.string(), name: z.string() });
 *
 * @Resolver()
 * class UserResolver {
 *   @GQLQuery('getUser')
 *   @Returns(UserSchema, { name: 'User' })
 *   async getUser(@Arg('id', z.string()) id: string) {
 *     return { id, name: 'John' };
 *   }
 *
 *   @GQLQuery('getUserNames')
 *   @Returns('[String!]')
 *   async getUserNames() {
 *     return ['John', 'Jane'];
 *   }
 * }
 * ```
 */
export function Returns(
  typeOrSchema: string | ZodSchema,
  options?: ReturnsOptions
): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    const metadata: GraphQLReturnTypeMetadata = {
      name: options?.name,
      nullable: options?.nullable,
      list: options?.list
    };

    if (typeof typeOrSchema === 'string') {
      metadata.type = typeOrSchema;
    } else {
      metadata.schema = typeOrSchema;
    }

    Reflect.defineMetadata(GRAPHQL_RETURN_KEY, metadata, target, propertyKey);
  };
}

/**
 * Get return-type metadata stored by @Returns on a resolver method.
 */
export function getReturnTypeMetadata(
  target: any,
  propertyKey: string
): GraphQLReturnTypeMetadata | undefined {
  return Reflect.getMetadata(GRAPHQL_RETURN_KEY, target, propertyKey);
}
