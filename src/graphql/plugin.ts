// GraphQL Plugin - Enables GraphQL support for Veloce-TS
import type { Plugin } from '../core/plugin.js';
import type { VeloceTS } from '../core/application.js';
import { GraphQLSchemaBuilder } from './schema-builder.js';
import type { GraphQLContext, GraphQLSubscriptionResolver } from './schema-builder.js';
import {
  GraphQLWSHandler,
  GRAPHQL_TRANSPORT_WS_PROTOCOL,
  type GraphQLExecutionModule,
  type GraphQLWSConnectionContext,
} from './ws-protocol.js';
import {
  getNodeWebSocketAdapter,
  injectNodeWebSocket,
  needsNodeWebSocketAdapter,
  type NodeWebSocketAdapter,
} from '../websocket/node-adapter.js';
import { getLogger } from '../logging/logger.js';

const isBunRuntime = (): boolean => typeof (globalThis as any).Bun !== 'undefined';
const isDenoRuntime = (): boolean => typeof (globalThis as any).Deno !== 'undefined';

/** Subscription transport configuration. */
export interface GraphQLSubscriptionOptions {
  /**
   * Path the WebSocket endpoint listens on.
   *
   * Defaults to the GraphQL path itself, which is what Apollo Client, urql and
   * GraphiQL assume — they point their socket at the same URL as the HTTP
   * endpoint. An upgrade request and a POST can share a path because they are
   * different methods.
   */
  path?: string;

  /**
   * Gate the connection when the client sends `connection_init`.
   *
   * Return `false` to refuse it (closed 4403). This is where a token is
   * checked: a browser WebSocket cannot send an `Authorization` header, so
   * credentials arrive in `connectionParams` instead.
   *
   * @example
   * ```typescript
   * onConnect: ({ connectionParams }) => Boolean(verify(connectionParams?.token))
   * ```
   */
  onConnect?: (
    connection: GraphQLWSConnectionContext
  ) => boolean | void | Record<string, unknown> | Promise<boolean | void | Record<string, unknown>>;

  /**
   * Build the `context` resolvers receive, once per connection.
   *
   * Distinct from the HTTP `context` option: a socket has no per-request
   * `Context`, and lives across many operations.
   */
  context?: (connection: GraphQLWSConnectionContext) => unknown | Promise<unknown>;

  /**
   * How long a client may take to send `connection_init` before being closed
   * with 4408.
   *
   * @default 3000
   */
  connectionInitWaitTimeout?: number;
}

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

  /**
   * Resolver classes decorated with @Resolver, @GQLQuery, @GQLMutation.
   * Pass all resolver classes here so the plugin can build the schema.
   *
   * @example
   * ```typescript
   * app.usePlugin(new GraphQLPlugin({
   *   resolvers: [UserResolver, PostResolver],
   * }));
   * ```
   */
  resolvers?: any[];

  /**
   * Serve subscriptions over WebSocket, using the **graphql-transport-ws**
   * subprotocol that Apollo Client, urql and GraphiQL speak.
   *
   * `true` enables it on the GraphQL path with the defaults; pass an object to
   * configure. Off by default — enabling it opens a WebSocket endpoint, which
   * should be a deliberate choice.
   *
   * Requires the `graphql` package, and on Node also `@hono/node-ws`. On Node
   * the app must be served with `app.listen()`.
   *
   * @example
   * ```typescript
   * app.usePlugin(new GraphQLPlugin({
   *   resolvers: [ChatResolver],
   *   subscriptions: {
   *     onConnect: ({ connectionParams }) => verify(connectionParams?.token),
   *   },
   * }));
   * ```
   */
  subscriptions?: boolean | GraphQLSubscriptionOptions;
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

  private options: Required<Omit<GraphQLPluginOptions, 'subscriptions'>>;
  private schema?: { typeDefs: string; resolvers: any };
  /** Executable graphql-js schema with resolvers attached (built lazily, cached). */
  private executableSchema?: any;
  /** The loaded `graphql` package, cached across requests and sockets. */
  private graphqlModule?: GraphQLExecutionModule;

  /** Undefined when subscriptions are off. */
  private readonly subscriptions?: Required<Pick<GraphQLSubscriptionOptions, 'path'>> &
    GraphQLSubscriptionOptions;
  /** Set only on Node, where upgrades go through the shared @hono/node-ws adapter. */
  private nodeWs?: NodeWebSocketAdapter;
  /** Live protocol handlers, so shutdown can end every open subscription. */
  private readonly connections = new Set<GraphQLWSHandler>();

  constructor(options?: GraphQLPluginOptions) {
    this.options = {
      path: options?.path || '/graphql',
      playgroundPath: options?.playgroundPath || '/graphql/playground',
      playground: options?.playground !== false,
      context: options?.context || ((request: any) => ({ request })),
      resolvers: options?.resolvers || []
    };

    if (options?.subscriptions) {
      const config = options.subscriptions === true ? {} : options.subscriptions;
      this.subscriptions = { ...config, path: config.path || this.options.path };
    }
  }

  async install(app: VeloceTS): Promise<void> {
    const container = app.getContainer();
    // Merge explicit resolvers (plugin options) with any registered via app.include()
    const fromRegistry = app.getMetadata().getGraphQLResolvers().map((m: any) => m.target);
    const fromOptions = this.options.resolvers as any[];
    const allResolvers = [...new Set([...fromOptions, ...fromRegistry])];
    const schemaBuilder = new GraphQLSchemaBuilder(allResolvers, container);
    this.schema = schemaBuilder.build();
    // Invalidate any cached executable schema (install may be called again)
    this.executableSchema = undefined;

    // Node borrows @hono/node-ws, whose upgradeWebSocket() middleware owns the
    // route — so the adapter has to exist before the route is registered.
    if (this.subscriptions && needsNodeWebSocketAdapter()) {
      this.nodeWs = await getNodeWebSocketAdapter(app);
    }

    // The WebSocket endpoint goes first when it shares a path with the HTTP
    // one: on Node the upgrade middleware must see the request before the GET
    // handler answers it.
    if (this.subscriptions) {
      this.registerSubscriptionEndpoint(app);
    }

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

        let parsedVariables: Record<string, any> | undefined;
        if (variables) {
          try {
            parsedVariables = JSON.parse(variables);
          } catch {
            return c.json({ error: 'Invalid JSON in variables parameter' }, 400);
          }
        }
        return this.executeGraphQL(c, {
          query,
          variables: parsedVariables,
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
   * Attach the WebSocket handler to the running HTTP server (Node only).
   *
   * `@hono/node-ws` needs the real `http.Server`, which does not exist until
   * `listen()` has run. The injection is shared and idempotent, so it does not
   * matter whether WebSocketPlugin got there first.
   */
  async onStart(app: VeloceTS): Promise<void> {
    if (!this.nodeWs) return;

    const server = app.getServer();
    const raw = (server as any)?.raw ?? server;
    if (!raw) {
      throw new Error(
        'GraphQL subscriptions could not reach the HTTP server to attach WebSocket support. ' +
        'This is expected when the app is served through getFetchHandler() instead of listen(); ' +
        'WebSocket upgrades need a real server.'
      );
    }

    injectNodeWebSocket(app, raw);
  }

  /**
   * End every open subscription. Without it the async iterators behind them
   * stay attached to their PubSub, keeping listeners alive past shutdown.
   */
  async onStop(): Promise<void> {
    for (const handler of Array.from(this.connections)) {
      handler.close();
    }
    this.connections.clear();
  }

  /** Open subscription connections. */
  get connectionCount(): number {
    return this.connections.size;
  }

  // --------------------------------------------------------------------------
  // Subscription transport
  // --------------------------------------------------------------------------

  private registerSubscriptionEndpoint(app: VeloceTS): void {
    const hono = app.getHono();
    const path = this.subscriptions!.path;

    if (this.nodeWs) {
      this.registerNodeSubscriptions(hono, path);
      return;
    }

    hono.get(path, async (c: any, next: () => Promise<void>) => {
      if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') {
        // Not an upgrade. Hand the request on: the GET query handler shares
        // this path, and returning a response here (even a 404) would end it.
        return next();
      }

      const handlerOptions = await this.buildHandlerOptions();
      if (!handlerOptions) {
        return c.text('GraphQL subscriptions require the "graphql" package', 501);
      }

      return isBunRuntime()
        ? this.upgradeBun(c, handlerOptions)
        : this.upgradeDeno(c, handlerOptions);
    });
  }

  /**
   * Bun upgrade. The subprotocol has to be echoed by hand — unlike `ws`, Bun
   * does not do it for you, and a browser aborts a connection whose offered
   * subprotocol comes back unconfirmed.
   */
  private upgradeBun(c: any, options: any): Response {
    if (!c.env?.upgrade) {
      return c.text('WebSocket upgrade not supported in this environment', 501);
    }

    let handler: GraphQLWSHandler | undefined;
    const self = this;

    const success = c.env.upgrade(c.req.raw, {
      headers: { 'Sec-WebSocket-Protocol': GRAPHQL_TRANSPORT_WS_PROTOCOL },
      data: {
        handlers: {
          open(ws: any) {
            handler = new GraphQLWSHandler(
              {
                protocol: GRAPHQL_TRANSPORT_WS_PROTOCOL,
                send: (data: string) => ws.send(data),
                close: (code: number, reason: string) => ws.close(code, reason),
              },
              options,
              { request: c.req.raw }
            );
            self.connections.add(handler);
          },
          message(_ws: any, message: string | Uint8Array) {
            void handler?.handleMessage(message as any);
          },
          close() {
            if (handler) {
              handler.close();
              self.connections.delete(handler);
              handler = undefined;
            }
          },
          error(_ws: any, error: Error) {
            getLogger().error('GraphQL subscription socket error', error, { path: c.req.path });
          },
        },
      },
    });

    if (!success) {
      return c.text('WebSocket upgrade failed', 500);
    }

    // Bun has already sent the 101; the return value is ignored, but Hono
    // requires a Response.
    return new Response(null, { status: 101 });
  }

  /** Deno upgrade. `protocol` is what makes Deno echo the subprotocol header. */
  private upgradeDeno(c: any, options: any): Response {
    const Deno = (globalThis as any).Deno;
    const { socket, response } = Deno.upgradeWebSocket(c.req.raw, {
      protocol: GRAPHQL_TRANSPORT_WS_PROTOCOL,
    });

    let handler: GraphQLWSHandler | undefined;

    socket.onopen = () => {
      handler = new GraphQLWSHandler(
        {
          protocol: GRAPHQL_TRANSPORT_WS_PROTOCOL,
          send: (data: string) => socket.send(data),
          close: (code: number, reason: string) => socket.close(code, reason),
        },
        options,
        { request: c.req.raw }
      );
      this.connections.add(handler);
    };

    socket.onmessage = (event: MessageEvent) => {
      void handler?.handleMessage(event.data);
    };

    socket.onclose = () => {
      if (handler) {
        handler.close();
        this.connections.delete(handler);
        handler = undefined;
      }
    };

    socket.onerror = (error: unknown) => {
      getLogger().error(
        'GraphQL subscription socket error',
        error instanceof Error ? error : new Error(String(error)),
        { path: c.req.path }
      );
    };

    return response;
  }

  /**
   * Node upgrade, through the shared @hono/node-ws adapter.
   *
   * `ws` echoes the first subprotocol the client offers, so no explicit
   * negotiation is needed here — but it also means the handler must verify what
   * was negotiated, which it does from `ctx.protocol`.
   */
  private registerNodeSubscriptions(hono: any, path: string): void {
    hono.get(
      path,
      this.nodeWs!.upgradeWebSocket((c: any) => {
        let handler: GraphQLWSHandler | undefined;
        const self = this;

        return {
          async onOpen(_evt: unknown, ws: any) {
            const options = await self.buildHandlerOptions();
            if (!options) {
              ws.close(1011, 'GraphQL subscriptions require the "graphql" package');
              return;
            }

            handler = new GraphQLWSHandler(
              {
                protocol: ws.protocol || GRAPHQL_TRANSPORT_WS_PROTOCOL,
                send: (data: string) => ws.send(data),
                close: (code: number, reason: string) => ws.close(code, reason),
              },
              options,
              { request: c.req.raw }
            );
            self.connections.add(handler);
          },

          async onMessage(evt: { data: unknown }) {
            await handler?.handleMessage(evt.data as any);
          },

          onClose() {
            if (handler) {
              handler.close();
              self.connections.delete(handler);
              handler = undefined;
            }
          },

          onError(error: unknown) {
            getLogger().error(
              'GraphQL subscription socket error',
              error instanceof Error ? error : new Error(String(error)),
              { path }
            );
          },
        };
      })
    );
  }

  /** Options for a new protocol handler, or undefined if `graphql` is missing. */
  private async buildHandlerOptions() {
    const graphql = await this.loadGraphQL();
    if (!graphql) return undefined;

    const schema = this.getExecutableSchema(graphql);
    if (!schema) return undefined;

    return {
      schema,
      graphql,
      onConnect: this.subscriptions!.onConnect,
      context: this.subscriptions!.context,
      connectionInitWaitTimeout: this.subscriptions!.connectionInitWaitTimeout,
    };
  }

  /** Load the optional `graphql` peer once. */
  private async loadGraphQL(): Promise<GraphQLExecutionModule | undefined> {
    if (this.graphqlModule) return this.graphqlModule;
    try {
      const specifier = 'graphql';
      this.graphqlModule = (await import(specifier)) as unknown as GraphQLExecutionModule;
      return this.graphqlModule;
    } catch {
      return undefined;
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
    const graphqlModule = await this.loadGraphQL();
    if (!graphqlModule) {
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
      const schema = this.getExecutableSchema(graphqlModule);
      const execute = (graphqlModule as any).graphql;

      const result = await execute({
        schema,
        source: query,
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
   * Build the executable schema once and cache it.
   *
   * `buildSchema()` is SDL-first and produces fields without resolvers, so the
   * functions generated by GraphQLSchemaBuilder are attached onto the schema
   * fields directly. (Passing the nested `{Query, Mutation}` map as `rootValue`
   * would NOT work: graphql-js resolves root fields against
   * `rootValue.<fieldName>`, not `rootValue.Query.<fieldName>`.)
   */
  private getExecutableSchema(graphqlModule: any): any {
    if (this.executableSchema) return this.executableSchema;
    if (!this.schema) return undefined;

    if (this.schema.typeDefs.trim() === '') {
      // buildSchema('') fails with "Syntax Error: Unexpected <EOF>", which sends
      // whoever hits it looking at their query. The cause is always the same:
      // no resolver metadata was found, either because no resolver was passed
      // or because the decorators came from a different copy of the framework.
      throw new Error(
        'GraphQL schema is empty: no @Resolver class with @GQLQuery/@GQLMutation/@GQLSubscription ' +
        'methods was found. Pass them to GraphQLPlugin({ resolvers: [...] }) or register them with ' +
        'app.include(). If they are registered and you still see this, check that the decorators and ' +
        'the plugin are imported from the same specifier — "veloce-ts" and "veloce-ts/plugins" are ' +
        'separate modules under CommonJS.'
      );
    }

    const schema = graphqlModule.buildSchema(this.schema.typeDefs);
    this.attachResolvers(schema.getQueryType(), this.schema.resolvers.Query);
    this.attachResolvers(schema.getMutationType(), this.schema.resolvers.Mutation);
    this.attachSubscriptionResolvers(
      schema.getSubscriptionType(),
      this.schema.resolvers.Subscription
    );
    this.executableSchema = schema;
    return schema;
  }

  /**
   * Attach resolver functions to the fields of a root type built by
   * buildSchema(). Mutates the field definitions in place.
   */
  private attachResolvers(
    rootType: any,
    resolverMap: Record<string, any> | undefined
  ): void {
    if (!rootType || !resolverMap) return;

    const fields = rootType.getFields();
    for (const [fieldName, resolverFn] of Object.entries(resolverMap)) {
      if (fields[fieldName]) {
        fields[fieldName].resolve = resolverFn;
      }
    }
  }

  /**
   * Attach subscription fields, which are a pair rather than a single
   * function: `subscribe` produces the event stream and `resolve` maps each
   * payload to the field value.
   *
   * Attached whether or not the WebSocket transport is enabled — a schema that
   * is complete makes introspection honest, and an SDL-only Subscription type
   * would advertise fields that cannot run.
   */
  private attachSubscriptionResolvers(
    rootType: any,
    resolverMap: Record<string, GraphQLSubscriptionResolver> | undefined
  ): void {
    if (!rootType || !resolverMap) return;

    const fields = rootType.getFields();
    for (const [fieldName, pair] of Object.entries(resolverMap)) {
      if (!fields[fieldName]) continue;
      fields[fieldName].subscribe = pair.subscribe;
      fields[fieldName].resolve = pair.resolve;
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
