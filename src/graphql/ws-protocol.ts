/**
 * @module veloce-ts/graphql/ws-protocol
 * @description Server side of the **graphql-transport-ws** protocol — the
 * subprotocol Apollo Client, urql, GraphiQL and the `graphql-ws` client all
 * speak.
 *
 * Deliberately transport-agnostic: it is handed a {@link GraphQLWSSocket} and
 * fed raw message strings, so the same state machine serves Bun's native
 * upgrade, Deno's, and Node's through `@hono/node-ws`.
 *
 * @see https://github.com/enisdenjo/graphql-ws/blob/master/PROTOCOL.md
 */
import { getLogger } from '../logging/logger.js';

/** The subprotocol a client must offer, and the server must echo. */
export const GRAPHQL_TRANSPORT_WS_PROTOCOL = 'graphql-transport-ws';

/**
 * Close codes from the protocol. 4400–4499 is the application range, so these
 * reach the client verbatim.
 */
export const CloseCode = {
  BadRequest: 4400,
  /** `subscribe` arrived before `connection_init` was acknowledged. */
  Unauthorized: 4401,
  Forbidden: 4403,
  ConnectionInitialisationTimeout: 4408,
  SubscriberAlreadyExists: 4409,
  TooManyInitialisationRequests: 4429,
} as const;

/** The slice of the `graphql` package this needs. */
export interface GraphQLExecutionModule {
  parse: (source: string) => any;
  validate: (schema: any, document: any) => readonly any[];
  execute: (args: any) => any;
  subscribe: (args: any) => any;
  getOperationAST: (document: any, operationName?: string | null) => any;
  GraphQLError: new (message: string, ...rest: any[]) => Error;
}

/** What the protocol handler needs from a socket. */
export interface GraphQLWSSocket {
  /** Negotiated subprotocol. Anything but `graphql-transport-ws` is refused. */
  protocol?: string;
  send(data: string): void | Promise<void>;
  close(code: number, reason: string): void;
}

/** Everything a resolver's `context` sees about the connection. */
export interface GraphQLWSConnectionContext {
  /** Payload the client sent with `connection_init` — where tokens usually go. */
  connectionParams?: Record<string, unknown>;
  /** Whatever the transport chose to expose (the upgrade request, the socket). */
  extra?: Record<string, unknown>;
}

export interface GraphQLWSHandlerOptions {
  /** Executable schema with resolvers attached. */
  schema: unknown;

  /** The loaded `graphql` package. */
  graphql: GraphQLExecutionModule;

  /**
   * Build the value passed to resolvers as `context`, per connection.
   * Runs once, after `connection_init` is accepted.
   */
  context?: (
    connection: GraphQLWSConnectionContext
  ) => unknown | Promise<unknown>;

  /**
   * Gate the connection on `connection_init`.
   *
   * Return `false` to refuse it (closed with 4403 Forbidden); return an object
   * to have it sent as the `connection_ack` payload. This is where a token in
   * `connectionParams` is checked — a WebSocket upgrade carries no
   * `Authorization` header from a browser.
   */
  onConnect?: (
    connection: GraphQLWSConnectionContext
  ) => boolean | void | Record<string, unknown> | Promise<boolean | void | Record<string, unknown>>;

  /**
   * How long a client may take to send `connection_init` before being closed
   * with 4408.
   *
   * @default 3000
   */
  connectionInitWaitTimeout?: number;
}

type Operation = { stop: () => void };

/**
 * One client connection. Create it on socket open, feed it every inbound
 * message, and call {@link close} when the socket goes away.
 */
export class GraphQLWSHandler {
  private readonly options: GraphQLWSHandlerOptions;
  private readonly socket: GraphQLWSSocket;
  private readonly extra?: Record<string, unknown>;

  private initReceived = false;
  private acknowledged = false;
  private closed = false;
  private connectionParams?: Record<string, unknown>;
  private contextValue: unknown;

  /** Live operations by client-chosen id. */
  private readonly operations = new Map<string, Operation>();
  /**
   * Ids seen but not yet running. `subscribe` is async, so without this a
   * second `subscribe` with the same id could slip past the duplicate check.
   */
  private readonly reservedIds = new Set<string>();

  private initTimer?: ReturnType<typeof setTimeout>;

  /**
   * @param extra - transport-specific values (the upgrade request, the raw
   *   socket) handed through to `onConnect` and the context factory.
   */
  constructor(
    socket: GraphQLWSSocket,
    options: GraphQLWSHandlerOptions,
    extra?: Record<string, unknown>
  ) {
    this.socket = socket;
    this.options = options;
    this.extra = extra;

    if (
      socket.protocol !== undefined &&
      socket.protocol !== '' &&
      socket.protocol !== GRAPHQL_TRANSPORT_WS_PROTOCOL
    ) {
      this.closeWith(
        CloseCode.BadRequest,
        `Subprotocol "${socket.protocol}" not acceptable`
      );
      return;
    }

    const wait = this.options.connectionInitWaitTimeout ?? 3000;
    if (wait > 0) {
      this.initTimer = setTimeout(() => {
        if (!this.initReceived) {
          this.closeWith(
            CloseCode.ConnectionInitialisationTimeout,
            'Connection initialisation timeout'
          );
        }
      }, wait);
      // Never hold the process open on a client that went quiet.
      this.initTimer.unref?.();
    }
  }

  /** Feed one inbound message. Never throws: protocol errors close the socket. */
  async handleMessage(raw: string | ArrayBuffer | Uint8Array): Promise<void> {
    if (this.closed) return;

    let message: any;
    try {
      message = JSON.parse(typeof raw === 'string' ? raw : decodeBinary(raw));
    } catch {
      this.closeWith(CloseCode.BadRequest, 'Invalid message received');
      return;
    }

    if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
      this.closeWith(CloseCode.BadRequest, 'Invalid message received');
      return;
    }

    switch (message.type) {
      case 'connection_init':
        await this.onConnectionInit(message);
        return;

      case 'ping':
        this.send({ type: 'pong', ...(message.payload ? { payload: message.payload } : {}) });
        return;

      case 'pong':
        // Nothing to do — a client answering our ping, or a keepalive.
        return;

      case 'subscribe':
        await this.onSubscribe(message);
        return;

      case 'complete':
        this.stopOperation(message.id);
        return;

      default:
        this.closeWith(CloseCode.BadRequest, `Unknown message type "${message.type}"`);
    }
  }

  /**
   * Tear down: stops every operation, so the async iterators behind them run
   * their `finally` blocks and detach from the PubSub.
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;

    if (this.initTimer) clearTimeout(this.initTimer);

    for (const id of Array.from(this.operations.keys())) {
      this.stopOperation(id);
    }
    this.reservedIds.clear();
  }

  /** Live operations, for tests and diagnostics. */
  get operationCount(): number {
    return this.operations.size;
  }

  // --------------------------------------------------------------------------

  private async onConnectionInit(message: any): Promise<void> {
    if (this.initReceived) {
      this.closeWith(
        CloseCode.TooManyInitialisationRequests,
        'Too many initialisation requests'
      );
      return;
    }
    this.initReceived = true;
    if (this.initTimer) clearTimeout(this.initTimer);

    this.connectionParams =
      message.payload && typeof message.payload === 'object' ? message.payload : undefined;

    const connection: GraphQLWSConnectionContext = {
      connectionParams: this.connectionParams,
      extra: this.extra,
    };

    let ackPayload: Record<string, unknown> | undefined;

    if (this.options.onConnect) {
      let permitted: unknown;
      try {
        permitted = await this.options.onConnect(connection);
      } catch (error) {
        getLogger().warn('GraphQL subscription onConnect threw; refusing connection', {
          error: error instanceof Error ? error.message : String(error),
        });
        this.closeWith(CloseCode.Forbidden, 'Forbidden');
        return;
      }

      if (permitted === false) {
        this.closeWith(CloseCode.Forbidden, 'Forbidden');
        return;
      }
      if (permitted && typeof permitted === 'object') {
        ackPayload = permitted as Record<string, unknown>;
      }
    }

    try {
      this.contextValue = this.options.context
        ? await this.options.context(connection)
        : connection;
    } catch (error) {
      getLogger().error(
        'GraphQL subscription context factory failed',
        error instanceof Error ? error : new Error(String(error))
      );
      this.closeWith(CloseCode.Forbidden, 'Forbidden');
      return;
    }

    this.acknowledged = true;
    this.send({ type: 'connection_ack', ...(ackPayload ? { payload: ackPayload } : {}) });
  }

  private async onSubscribe(message: any): Promise<void> {
    if (!this.acknowledged) {
      this.closeWith(CloseCode.Unauthorized, 'Unauthorized');
      return;
    }

    const id = message.id;
    if (typeof id !== 'string' || id === '') {
      this.closeWith(CloseCode.BadRequest, 'Invalid subscribe message: missing id');
      return;
    }
    if (this.operations.has(id) || this.reservedIds.has(id)) {
      this.closeWith(CloseCode.SubscriberAlreadyExists, `Subscriber for ${id} already exists`);
      return;
    }

    const payload = message.payload;
    if (!payload || typeof payload.query !== 'string') {
      this.closeWith(CloseCode.BadRequest, 'Invalid subscribe message: missing query');
      return;
    }

    this.reservedIds.add(id);

    const { parse, validate, execute, subscribe, getOperationAST } = this.options.graphql;

    let document: any;
    try {
      document = parse(payload.query);
    } catch (error: any) {
      this.reservedIds.delete(id);
      this.send({ type: 'error', id, payload: [serializeError(error)] });
      return;
    }

    // validate() throws — it does not return — when the schema itself is
    // invalid (a missing Query root, say). That is a server fault, not a client
    // one, so it must reach the client as an error message rather than escaping
    // into the socket's message handler and taking the process down.
    let validationErrors: readonly any[];
    try {
      validationErrors = validate(this.options.schema, document);
    } catch (error: any) {
      this.reservedIds.delete(id);
      this.send({ type: 'error', id, payload: [serializeError(error)] });
      return;
    }

    if (validationErrors.length > 0) {
      this.reservedIds.delete(id);
      this.send({ type: 'error', id, payload: validationErrors.map(serializeError) });
      return;
    }

    const args = {
      schema: this.options.schema,
      document,
      contextValue: this.contextValue,
      variableValues: payload.variables ?? undefined,
      operationName: payload.operationName ?? undefined,
    };

    const operationAst = getOperationAST(document, payload.operationName ?? null);
    const isSubscription = operationAst?.operation === 'subscription';

    try {
      // Queries and mutations are legal over this transport too: one `next`,
      // then `complete`. Clients that route everything through the socket rely
      // on it.
      const result = isSubscription ? await subscribe(args) : await execute(args);

      if (this.closed || !this.reservedIds.has(id)) {
        // The client sent `complete`, or the socket died, while we were awaiting.
        await closeAsyncIterable(result);
        this.reservedIds.delete(id);
        return;
      }

      if (!isAsyncIterable(result)) {
        // subscribe() returns a plain ExecutionResult when it could not create
        // the source — the protocol wants that as `error`, not as `next`.
        this.reservedIds.delete(id);
        if (isSubscription && result?.errors?.length) {
          this.send({ type: 'error', id, payload: result.errors.map(serializeError) });
        } else {
          this.send({ type: 'next', id, payload: result });
          this.send({ type: 'complete', id });
        }
        return;
      }

      this.streamOperation(id, result);
    } catch (error: any) {
      this.reservedIds.delete(id);
      if (this.closed) return;
      this.send({ type: 'error', id, payload: [serializeError(error)] });
    }
  }

  /** Pump an async iterable into `next` messages until it ends or is stopped. */
  private streamOperation(id: string, source: AsyncIterable<any>): void {
    const iterator = (source as any)[Symbol.asyncIterator]() as AsyncIterator<any>;
    let stopped = false;

    this.reservedIds.delete(id);
    this.operations.set(id, {
      stop: () => {
        if (stopped) return;
        stopped = true;
        // Ends the iterator, which lets PubSub detach its bus listener.
        void iterator.return?.();
      },
    });

    void (async () => {
      try {
        while (!stopped && !this.closed) {
          const next = await iterator.next();
          if (next.done) break;
          if (stopped || this.closed) break;
          this.send({ type: 'next', id, payload: next.value });
        }

        if (!stopped && !this.closed) {
          this.send({ type: 'complete', id });
        }
      } catch (error: any) {
        if (!stopped && !this.closed) {
          this.send({ type: 'error', id, payload: [serializeError(error)] });
        }
      } finally {
        this.operations.delete(id);
      }
    })();
  }

  private stopOperation(id: unknown): void {
    if (typeof id !== 'string') return;
    this.reservedIds.delete(id);
    const operation = this.operations.get(id);
    if (!operation) return;
    this.operations.delete(id);
    operation.stop();
  }

  private send(message: Record<string, unknown>): void {
    if (this.closed) return;
    try {
      const sent = this.socket.send(JSON.stringify(message));
      // A socket whose send() is async can reject after the fact; swallow it,
      // because a dead socket is handled by the close path.
      if (sent && typeof (sent as Promise<void>).catch === 'function') {
        (sent as Promise<void>).catch(() => {});
      }
    } catch {
      // Socket already gone.
    }
  }

  private closeWith(code: number, reason: string): void {
    if (this.closed) return;
    // Mark closed before close(), so nothing else is written to the socket.
    this.close();
    try {
      this.socket.close(code, reason);
    } catch {
      // Already gone.
    }
  }
}

// ----------------------------------------------------------------------------

function isAsyncIterable(value: any): value is AsyncIterable<any> {
  return Boolean(value) && typeof value[Symbol.asyncIterator] === 'function';
}

async function closeAsyncIterable(value: any): Promise<void> {
  if (!isAsyncIterable(value)) return;
  try {
    await value[Symbol.asyncIterator]().return?.();
  } catch {
    // Nothing useful to do while tearing down.
  }
}

function decodeBinary(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return new TextDecoder().decode(bytes);
}

/**
 * GraphQL errors are not JSON-serializable as-is (`message` lives on the
 * prototype chain for a plain `Error`), so build the wire shape explicitly.
 */
function serializeError(error: any): Record<string, unknown> {
  if (!error) return { message: 'Unknown error' };
  if (typeof error.toJSON === 'function') return error.toJSON();

  return {
    message: error.message ?? String(error),
    ...(error.locations ? { locations: error.locations } : {}),
    ...(error.path ? { path: error.path } : {}),
    ...(error.extensions ? { extensions: error.extensions } : {}),
  };
}
