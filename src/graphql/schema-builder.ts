// GraphQL Schema Builder for FastAPI-TS
import type { MetadataRegistry } from '../core/metadata';
import type { DIContainer } from '../dependencies/container';
import type { GraphQLFieldMetadata, GraphQLArgumentMetadata, Context } from '../types';
import { getArgumentsMetadata } from '../decorators/graphql';
import { zodToGraphQLType, isNullable } from './zod-to-graphql';
import { ValidationEngine } from '../validation/validator';

/**
 * GraphQL Schema Builder
 * Generates GraphQL schema from decorator metadata
 */
export class GraphQLSchemaBuilder {
  private validationEngine: ValidationEngine;
  private customTypes: Map<string, string> = new Map();

  constructor(
    private metadata: MetadataRegistry,
    private container: DIContainer
  ) {
    this.validationEngine = new ValidationEngine();
  }

  /**
   * Build the complete GraphQL schema
   */
  build(): GraphQLSchemaDefinition {
    const resolvers = this.metadata.getGraphQLResolvers();
    
    const queries: string[] = [];
    const mutations: string[] = [];
    const subscriptions: string[] = [];
    const types: string[] = [];

    // Process each resolver
    for (const resolver of resolvers) {
      const fields = this.metadata.getGraphQLFieldsByResolver(resolver.target);

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

    // Add custom types
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

    // Add Subscription type
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
        argType = zodToGraphQLType(arg.schema);
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
    
    // For now, default return type to String (can be enhanced with type inference)
    const returnType = 'String';

    let fieldStr = `${field.name}${argsStr}: ${returnType}`;

    // Add deprecation
    if (field.deprecated) {
      const reason = field.deprecationReason || 'No longer supported';
      fieldStr += ` @deprecated(reason: "${reason}")`;
    }

    return fieldStr;
  }

  /**
   * Build resolvers object with validation and DI
   */
  private buildResolvers(): GraphQLResolvers {
    const resolvers = this.metadata.getGraphQLResolvers();
    const resolversObj: GraphQLResolvers = {
      Query: {},
      Mutation: {},
      Subscription: {}
    };

    for (const resolver of resolvers) {
      const fields = this.metadata.getGraphQLFieldsByResolver(resolver.target);

      for (const field of fields) {
        const resolverFn = this.createResolverFunction(resolver.target, field);

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
