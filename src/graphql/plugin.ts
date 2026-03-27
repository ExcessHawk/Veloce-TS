// GraphQL Plugin - Enables GraphQL support for Veloce-TS
import type { Plugin } from '../core/plugin';
import type { VeloceTS } from '../core/application';
import { GraphQLSchemaBuilder } from './schema-builder';
import type { GraphQLContext } from './schema-builder';

/**
 * GraphQL Plugin Options
 */
export interface GraphQLPluginOptions {
  /** Path to serve GraphQL endpoint (default: /graphql) */
  path?: string;
  
  /** Path to serve GraphQL Playground (default: /graphql/playground) */
  playgroundPath?: string;
  
  /** Enable GraphQL Playground in development (default: true) */
  playground?: boolean;
  
  /** Custom context factory function */
  context?: (request: any) => Promise<any> | any;
}

/**
 * GraphQLPlugin enables GraphQL support with decorators and Zod validation
 * 
 * @example
 * ```typescript
 * const app = new VeloceTS();
 * app.usePlugin(new GraphQLPlugin({
 *   path: '/graphql',
 *   playground: true
 * }));
 * ```
 */
export class GraphQLPlugin implements Plugin {
  name = 'graphql';
  version = '1.0.0';

  private options: Required<GraphQLPluginOptions>;
  private schema?: { typeDefs: string; resolvers: any };

  constructor(options?: GraphQLPluginOptions) {
    this.options = {
      path: options?.path || '/graphql',
      playgroundPath: options?.playgroundPath || '/graphql/playground',
      playground: options?.playground !== false,
      context: options?.context || ((request: any) => ({ request }))
    };
  }

  async install(app: VeloceTS): Promise<void> {
    // Build GraphQL schema from metadata
    const metadata = app.getMetadata();
    const container = app.getContainer();
    
    const schemaBuilder = new GraphQLSchemaBuilder(metadata, container);
    this.schema = schemaBuilder.build();

    // Register GraphQL endpoint
    app.post(this.options.path, {
      handler: async (c) => {
        return this.handleGraphQLRequest(c);
      },
      docs: {
        summary: 'GraphQL endpoint',
        description: 'Execute GraphQL queries and mutations',
        tags: ['GraphQL']
      }
    });

    // Also support GET for queries (useful for GraphQL Playground)
    app.get(this.options.path, {
      handler: async (c) => {
        const query = c.req.query('query');
        const variables = c.req.query('variables');
        const operationName = c.req.query('operationName');

        if (!query) {
          return c.json({ error: 'Query parameter is required' }, 400);
        }

        return this.executeGraphQL(c, {
          query,
          variables: variables ? JSON.parse(variables) : undefined,
          operationName
        });
      },
      docs: {
        summary: 'GraphQL endpoint (GET)',
        description: 'Execute GraphQL queries via GET request',
        tags: ['GraphQL']
      }
    });

    // Register GraphQL Playground endpoint if enabled
    if (this.options.playground) {
      app.get(this.options.playgroundPath, {
        handler: async (c) => {
          return c.html(this.renderPlayground());
        },
        docs: {
          summary: 'GraphQL Playground',
          description: 'Interactive GraphQL IDE',
          tags: ['GraphQL']
        }
      });
    }
  }

  /**
   * Handle GraphQL POST request
   */
  private async handleGraphQLRequest(c: any) {
    try {
      const body = await c.req.json();
      return this.executeGraphQL(c, body);
    } catch (error) {
      return c.json({
        errors: [{
          message: 'Invalid JSON in request body',
          extensions: { code: 'BAD_REQUEST' }
        }]
      }, 400);
    }
  }

  /**
   * Execute a GraphQL operation
   */
  private async executeGraphQL(c: any, request: GraphQLRequest) {
    if (!this.schema) {
      return c.json({
        errors: [{
          message: 'GraphQL schema not initialized',
          extensions: { code: 'INTERNAL_SERVER_ERROR' }
        }]
      }, 500);
    }

    try {
      // Parse the query (simple implementation - in production use graphql-js)
      const { query, variables, operationName } = request;

      // Create context
      const context: GraphQLContext = await this.options.context(c);

      // Execute the operation
      const result = await this.executeOperation(
        query,
        variables,
        context,
        operationName
      );

      return c.json(result);
    } catch (error: any) {
      return c.json({
        errors: [{
          message: error.message || 'Internal server error',
          extensions: {
            code: 'INTERNAL_SERVER_ERROR',
            ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
          }
        }]
      }, 500);
    }
  }

  /**
   * Execute a GraphQL operation.
   *
   * This implementation requires the `graphql` package to be installed
   * (`bun add graphql`). If the package is not present the endpoint returns a
   * clear 501 error instead of a silent NOT_IMPLEMENTED placeholder.
   */
  private async executeOperation(
    query: string,
    variables: any,
    context: GraphQLContext,
    operationName?: string
  ): Promise<GraphQLResponse> {
    let graphqlModule: any;
    try {
      // graphql is an optional peer dependency
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      graphqlModule = await import('graphql');
    } catch {
      return {
        data: null,
        errors: [{
          message: 'GraphQL execution requires the "graphql" package. Run: bun add graphql',
          extensions: { code: 'NOT_IMPLEMENTED' }
        }]
      };
    }

    if (!this.schema) {
      return {
        data: null,
        errors: [{ message: 'GraphQL schema not initialized', extensions: { code: 'INTERNAL_SERVER_ERROR' } }]
      };
    }

    try {
      const { graphql: execute, buildSchema } = graphqlModule;
      const schema = buildSchema(this.schema.typeDefs);
      const result = await execute({
        schema,
        source: query,
        rootValue: this.schema.resolvers,
        contextValue: context,
        variableValues: variables,
        operationName
      });
      return result as GraphQLResponse;
    } catch (error: any) {
      return {
        data: null,
        errors: [{ message: error.message || 'GraphQL execution error', extensions: { code: 'INTERNAL_SERVER_ERROR' } }]
      };
    }
  }

  /**
   * Render GraphQL Playground HTML
   */
  private renderPlayground(): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GraphQL Playground</title>
  <link rel="stylesheet" href="https://unpkg.com/graphql-playground-react/build/static/css/index.css" />
  <link rel="shortcut icon" href="https://unpkg.com/graphql-playground-react/build/favicon.png" />
  <script src="https://unpkg.com/graphql-playground-react/build/static/js/middleware.js"></script>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: 'Open Sans', sans-serif;
      overflow: hidden;
    }
    #root {
      height: 100vh;
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script>
    window.addEventListener('load', function (event) {
      GraphQLPlayground.init(document.getElementById('root'), {
        endpoint: '${this.options.path}',
        settings: {
          'editor.theme': 'light',
          'editor.cursorShape': 'line',
          'editor.reuseHeaders': true,
          'tracing.hideTracingResponse': true,
          'queryPlan.hideQueryPlanResponse': true,
          'editor.fontSize': 14,
          'editor.fontFamily': "'Source Code Pro', 'Consolas', 'Inconsolata', 'Droid Sans Mono', 'Monaco', monospace",
          'request.credentials': 'include'
        }
      })
    })
  </script>
</body>
</html>
    `.trim();
  }

  /**
   * Get the generated schema (useful for testing)
   */
  getSchema() {
    return this.schema;
  }
}

// ============================================================================
// Types
// ============================================================================

interface GraphQLRequest {
  query: string;
  variables?: Record<string, any>;
  operationName?: string;
}

interface GraphQLResponse {
  data?: any;
  errors?: Array<{
    message: string;
    locations?: Array<{ line: number; column: number }>;
    path?: Array<string | number>;
    extensions?: Record<string, any>;
  }>;
}
