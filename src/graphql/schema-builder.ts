// GraphQL Schema Builder for Veloce-TS
import type { DIContainer } from '../dependencies/container.js';
import type { GraphQLFieldMetadata, Context } from '../types/index.js';
import { getResolverMetadata, getFieldsMetadata, getArgumentsMetadata } from '../decorators/graphql.js';
import {
  zodToGraphQLType,
  isNullable,
  unwrapZodSchema,
  getZodTypeName,
  zodObjectToGraphQLType,
  zodObjectToGraphQLInput
} from './zod-to-graphql.js';
import { getReturnTypeMetadata, type GraphQLReturnTypeMetadata } from './returns.js';
import { ValidationEngine } from '../validation/validator.js';

/**
 * GraphQL Schema Builder
 * Generates GraphQL schema from resolver classes decorated with @Resolver/@GQLQuery/@GQLMutation.
 */
export class GraphQLSchemaBuilder {
  private validationEngine: ValidationEngine;
  private customTypes: Map<string, string> = new Map();
  /** Set when any field/argument falls back to the generic JSON scalar. */
  private needsJsonScalar = false;

  constructor(
    private resolverClasses: any[],
    private container: DIContainer
  ) {
    this.validationEngine = new ValidationEngine();
  }

  /**
   * Build the complete GraphQL schema from resolver classes.
   */
  build(): GraphQLSchemaDefinition {
    const queries: string[] = [];
    const mutations: string[] = [];
    const subscriptions: string[] = [];

    // Reset state so build() is idempotent
    this.customTypes.clear();
    this.needsJsonScalar = false;

    for (const resolverClass of this.resolverClasses) {
      const resolverMeta = getResolverMetadata(resolverClass);
      if (!resolverMeta) continue;

      const fields = getFieldsMetadata(resolverClass);

      for (const field of fields) {
        const fieldDef = this.buildFieldDefinition(field);

        switch (field.type) {
          case 'query':
            queries.push(fieldDef);
            break;
          case 'mutation':
            mutations.push(fieldDef);
            break;
          case 'subscription':
            subscriptions.push(fieldDef);
            break;
        }
      }
    }

    // Build type definitions
    let typeDefs = '';

    // Declare the generic JSON scalar when any field/argument fell back to it.
    // buildSchema() gives custom scalars identity serialization, so plain
    // objects/arrays pass through results untouched.
    if (this.needsJsonScalar) {
      typeDefs += 'scalar JSON\n\n';
    }

    // Add custom types (object/input types emitted from Zod schemas)
    if (this.customTypes.size > 0) {
      typeDefs += Array.from(this.customTypes.values()).join('\n\n') + '\n\n';
    }

    // Add Query type
    if (queries.length > 0) {
      typeDefs += 'type Query {\n';
      typeDefs += queries.map(q => `  ${q}`).join('\n');
      typeDefs += '\n}\n\n';
    }

    // Add Mutation type
    if (mutations.length > 0) {
      typeDefs += 'type Mutation {\n';
      typeDefs += mutations.map(m => `  ${m}`).join('\n');
      typeDefs += '\n}\n\n';
    }

    // Add Subscription type.
    // NOTE: only SDL generation is supported for subscriptions. Executing
    // them requires a WebSocket (or SSE) transport, which is out of scope —
    // the HTTP plugin does not wire subscription resolvers into execution.
    if (subscriptions.length > 0) {
      typeDefs += 'type Subscription {\n';
      typeDefs += subscriptions.map(s => `  ${s}`).join('\n');
      typeDefs += '\n}\n';
    }

    // Build resolvers object
    const resolversObj = this.buildResolvers();

    return {
      typeDefs: typeDefs.trim(),
      resolvers: resolversObj
    };
  }

  /**
   * Build a field definition string
   */
  private buildFieldDefinition(field: GraphQLFieldMetadata): string {
    const args = getArgumentsMetadata(field.target.prototype, field.propertyKey);
    const argStrings: string[] = [];

    // Build arguments
    for (const arg of args) {
      if (arg.name === '__context__') continue; // Skip context injection

      let argType = 'String'; // Default type

      if (arg.schema) {
        const unwrapped = unwrapZodSchema(arg.schema);

        if (getZodTypeName(unwrapped) === 'ZodObject') {
          // Object arguments become named GraphQL input types generated from
          // the Zod schema via zodObjectToGraphQLInput.
          const inputName = this.registerInputType(field.name!, arg.name, unwrapped);
          argType = inputName;
        } else {
          argType = zodToGraphQLType(arg.schema);
          if (argType === 'JSON' || argType.includes('JSON')) {
            this.needsJsonScalar = true;
          }
        }

        const nullable = isNullable(arg.schema);
        if (!nullable && !arg.nullable) {
          argType += '!';
        }
      }

      let argStr = `${arg.name}: ${argType}`;

      if (arg.defaultValue !== undefined) {
        argStr += ` = ${JSON.stringify(arg.defaultValue)}`;
      }

      argStrings.push(argStr);
    }

    const argsStr = argStrings.length > 0 ? `(${argStrings.join(', ')})` : '';

    const returnType = this.resolveReturnType(field);

    let fieldStr = `${field.name}${argsStr}: ${returnType}`;

    // Add deprecation
    if (field.deprecated) {
      const reason = field.deprecationReason || 'No longer supported';
      fieldStr += ` @deprecated(reason: "${reason}")`;
    }

    return fieldStr;
  }

  /**
   * Resolve the GraphQL return type for a query/mutation/subscription field.
   *
   * Sources, in priority order:
   *   1. `field.returnType` from the field metadata (string SDL reference or
   *      Zod schema), when a decorator populated it.
   *   2. `@Returns(...)` metadata stored on the resolver method.
   *   3. Fallback: the generic `JSON` scalar. Resolver methods without a
   *      declared return type cannot be introspected reliably at runtime, so
   *      their results pass through as arbitrary JSON (nullable).
   */
  private resolveReturnType(field: GraphQLFieldMetadata): string {
    // Normalize sources into a single metadata shape
    let meta: GraphQLReturnTypeMetadata | undefined =
      getReturnTypeMetadata(field.target.prototype, field.propertyKey);

    if (field.returnType !== undefined && field.returnType !== null) {
      if (typeof field.returnType === 'string') {
        meta = { ...meta, type: field.returnType };
      } else if ((field.returnType as any)?._def) {
        meta = { ...meta, schema: field.returnType };
      }
    }

    if (!meta || (!meta.type && !meta.schema)) {
      // Fallback: no declared return type → generic JSON scalar (nullable)
      this.needsJsonScalar = true;
      return 'JSON';
    }

    let baseType: string;

    if (meta.type) {
      // Raw SDL type reference is used verbatim; the author controls
      // nullability/list markers via the string or the options.
      baseType = meta.type;
      if (/\bJSON\b/.test(baseType)) {
        this.needsJsonScalar = true;
      }
      // If the author already provided list/non-null markers, keep them as-is
      if (/[[\]!]/.test(baseType)) {
        return baseType;
      }
    } else {
      baseType = this.registerSchemaReturnType(field, meta);
      if (baseType.includes('[')) {
        // registerSchemaReturnType already produced the full list form
        return meta.nullable ? baseType : `${baseType}!`;
      }
    }

    if (meta.list) {
      baseType = `[${baseType}!]`;
    }

    return meta.nullable ? baseType : `${baseType}!`;
  }

  /**
   * Convert a Zod return schema into an SDL type reference, registering any
   * generated object types in `customTypes`.
   */
  private registerSchemaReturnType(
    field: GraphQLFieldMetadata,
    meta: GraphQLReturnTypeMetadata
  ): string {
    const unwrapped = unwrapZodSchema(meta.schema!);
    const typeName = getZodTypeName(unwrapped);

    if (typeName === 'ZodObject') {
      const name = meta.name || pascalCase(field.name || field.propertyKey);
      this.registerObjectType(name, unwrapped);
      return name;
    }

    if (typeName === 'ZodArray') {
      const element = unwrapZodSchema((unwrapped as any)._def.type);
      if (getZodTypeName(element) === 'ZodObject') {
        const name = meta.name || pascalCase(field.name || field.propertyKey);
        this.registerObjectType(name, element);
        return `[${name}!]`;
      }
      const elementType = zodToGraphQLType(element as any);
      if (elementType.includes('JSON')) this.needsJsonScalar = true;
      return `[${elementType}!]`;
    }

    const scalar = zodToGraphQLType(unwrapped as any);
    if (scalar.includes('JSON')) this.needsJsonScalar = true;
    return scalar;
  }

  /**
   * Register a GraphQL object type generated from a ZodObject schema.
   * First registration wins for a given name.
   */
  private registerObjectType(name: string, schema: any): void {
    if (!this.customTypes.has(name)) {
      const sdl = zodObjectToGraphQLType(name, schema);
      if (/:\s*JSON\b/.test(sdl)) this.needsJsonScalar = true;
      this.customTypes.set(name, sdl);
    }
  }

  /**
   * Register a GraphQL input type generated from a ZodObject argument schema.
   * The name is derived from the field and argument names (e.g. the `input`
   * argument of `createUser` becomes `CreateUserInput`).
   */
  private registerInputType(fieldName: string, argName: string, schema: any): string {
    let name = `${pascalCase(fieldName)}${pascalCase(argName)}`;
    if (!name.endsWith('Input')) {
      name += 'Input';
    }
    if (!this.customTypes.has(name)) {
      const sdl = zodObjectToGraphQLInput(name, schema);
      if (/:\s*JSON\b/.test(sdl)) this.needsJsonScalar = true;
      this.customTypes.set(name, sdl);
    }
    return name;
  }

  /**
   * Build resolvers object with validation and DI
   */
  private buildResolvers(): GraphQLResolvers {
    const resolversObj: GraphQLResolvers = {
      Query: {},
      Mutation: {},
      Subscription: {}
    };

    for (const resolverClass of this.resolverClasses) {
      const resolverMeta = getResolverMetadata(resolverClass);
      if (!resolverMeta) continue;

      const fields = getFieldsMetadata(resolverClass);

      for (const field of fields) {
        const resolverFn = this.createResolverFunction(resolverClass, field);

        switch (field.type) {
          case 'query':
            resolversObj.Query![field.name!] = resolverFn;
            break;
          case 'mutation':
            resolversObj.Mutation![field.name!] = resolverFn;
            break;
          case 'subscription':
            resolversObj.Subscription![field.name!] = resolverFn;
            break;
        }
      }
    }

    return resolversObj;
  }

  /**
   * Create a resolver function with validation and DI
   */
  private createResolverFunction(
    target: any,
    field: GraphQLFieldMetadata
  ): GraphQLResolverFn {
    return async (parent: any, args: any, context: GraphQLContext, info: any) => {
      try {
        // Get argument metadata
        const argsMetadata = getArgumentsMetadata(target.prototype, field.propertyKey);
        const resolvedArgs: any[] = [];

        // Validate and resolve arguments
        for (const argMeta of argsMetadata) {
          if (argMeta.name === '__context__') {
            // Inject context
            resolvedArgs[argMeta.index] = context;
          } else {
            let value = args[argMeta.name];

            // Apply default value if not provided
            if (value === undefined && argMeta.defaultValue !== undefined) {
              value = argMeta.defaultValue;
            }

            // Validate with Zod schema
            if (argMeta.schema) {
              value = await this.validationEngine.validate(value, argMeta.schema);
            }

            resolvedArgs[argMeta.index] = value;
          }
        }

        // Resolve the resolver instance (with DI support)
        const instance: any = await this.container.resolve(target, {
          scope: 'request',
          context: context.request
        });

        // Execute the resolver method
        const result = await instance[field.propertyKey](...resolvedArgs);

        return result;
      } catch (error) {
        // Re-throw for GraphQL error handling
        throw error;
      }
    };
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Capitalize the first letter of a name (e.g. 'createUser' → 'CreateUser').
 */
function pascalCase(name: string): string {
  if (!name) return name;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// ============================================================================
// Types
// ============================================================================

export interface GraphQLSchemaDefinition {
  typeDefs: string;
  resolvers: GraphQLResolvers;
}

export interface GraphQLResolvers {
  Query?: Record<string, GraphQLResolverFn>;
  Mutation?: Record<string, GraphQLResolverFn>;
  Subscription?: Record<string, GraphQLResolverFn>;
}

export type GraphQLResolverFn = (
  parent: any,
  args: any,
  context: GraphQLContext,
  info: any
) => any | Promise<any>;

export interface GraphQLContext {
  request: Context;
  user?: any;
  [key: string]: any;
}
