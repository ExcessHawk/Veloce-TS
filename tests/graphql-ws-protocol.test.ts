/**
 * The graphql-transport-ws state machine, driven through a fake socket.
 *
 * Every expectation here is a rule from the protocol spec:
 * https://github.com/enisdenjo/graphql-ws/blob/master/PROTOCOL.md
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import * as graphqlModule from 'graphql';
import {
  GraphQLWSHandler,
  CloseCode,
  GRAPHQL_TRANSPORT_WS_PROTOCOL,
  type GraphQLWSSocket,
} from '../src/graphql/ws-protocol';
import { PubSub } from '../src/graphql/pubsub';

const graphql = graphqlModule as any;

let pubsub: PubSub;

function buildSchema() {
  const { GraphQLSchema, GraphQLObjectType, GraphQLString, GraphQLNonNull } = graphql;

  const Query = new GraphQLObjectType({
    name: 'Query',
    fields: {
      hello: { type: GraphQLString, resolve: () => 'world' },
      boom: {
        type: GraphQLString,
        resolve: () => {
          throw new Error('resolver exploded');
        },
      },
    },
  });

  const Subscription = new GraphQLObjectType({
    name: 'Subscription',
    fields: {
      messages: {
        type: new GraphQLNonNull(GraphQLString),
        subscribe: () => pubsub.subscribe<string>('MESSAGES'),
        resolve: (payload: string) => payload,
      },
      failing: {
        type: GraphQLString,
        subscribe: () => {
          throw new Error('cannot open stream');
        },
      },
    },
  });

  return new GraphQLSchema({ query: Query, subscription: Subscription });
}

/** Records everything the handler writes, and lets a test await the next frame. */
class FakeSocket implements GraphQLWSSocket {
  sent: any[] = [];
  closedWith?: { code: number; reason: string };
  protocol = GRAPHQL_TRANSPORT_WS_PROTOCOL;

  private waiters: Array<(msg: any) => void> = [];

  send(data: string): void {
    const message = JSON.parse(data);
    const waiter = this.waiters.shift();
    if (waiter) waiter(message);
    else this.sent.push(message);
  }

  close(code: number, reason: string): void {
    this.closedWith ??= { code, reason };
  }

  /** Next frame, buffering so nothing sent before the call is missed. */
  next(timeoutMs = 1000): Promise<any> {
    if (this.sent.length > 0) return Promise.resolve(this.sent.shift());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for a frame')), timeoutMs);
      this.waiters.push(msg => {
        clearTimeout(timer);
        resolve(msg);
      });
    });
  }
}

function makeHandler(socket: FakeSocket, options: Record<string, unknown> = {}) {
  return new GraphQLWSHandler(socket, {
    schema: buildSchema(),
    graphql,
    ...options,
  } as any);
}

/** Connect and acknowledge, the precondition for everything but the init tests. */
async function connected(options: Record<string, unknown> = {}) {
  const socket = new FakeSocket();
  const handler = makeHandler(socket, options);
  await handler.handleMessage(JSON.stringify({ type: 'connection_init' }));
  const ack = await socket.next();
  expect(ack.type).toBe('connection_ack');
  return { socket, handler };
}

beforeEach(() => {
  pubsub = new PubSub();
});

describe('connection handshake', () => {
  it('acknowledges connection_init', async () => {
    const { socket } = await connected();
    expect(socket.closedWith).toBeUndefined();
  });

  it('closes 4429 on a second connection_init', async () => {
    const { socket, handler } = await connected();
    await handler.handleMessage(JSON.stringify({ type: 'connection_init' }));
    expect(socket.closedWith?.code).toBe(CloseCode.TooManyInitialisationRequests);
  });

  it('closes 4401 when subscribe arrives before the handshake', async () => {
    const socket = new FakeSocket();
    const handler = makeHandler(socket);

    await handler.handleMessage(
      JSON.stringify({ type: 'subscribe', id: '1', payload: { query: '{ hello }' } })
    );

    expect(socket.closedWith?.code).toBe(CloseCode.Unauthorized);
  });

  it('closes 4408 when connection_init never arrives', async () => {
    const socket = new FakeSocket();
    makeHandler(socket, { connectionInitWaitTimeout: 30 });

    await new Promise(r => setTimeout(r, 80));

    expect(socket.closedWith?.code).toBe(CloseCode.ConnectionInitialisationTimeout);
  });

  it('refuses a socket that negotiated a different subprotocol', () => {
    const socket = new FakeSocket();
    socket.protocol = 'graphql-ws'; // the legacy, incompatible subprotocol
    makeHandler(socket);

    expect(socket.closedWith?.code).toBe(CloseCode.BadRequest);
  });

  it('accepts a socket whose runtime reports no subprotocol', async () => {
    const socket = new FakeSocket();
    socket.protocol = '';
    const handler = makeHandler(socket);

    await handler.handleMessage(JSON.stringify({ type: 'connection_init' }));

    expect((await socket.next()).type).toBe('connection_ack');
  });
});

describe('onConnect', () => {
  it('receives the connectionParams the client sent', async () => {
    const socket = new FakeSocket();
    let seen: unknown;
    const handler = makeHandler(socket, {
      onConnect: (connection: any) => {
        seen = connection.connectionParams;
        return true;
      },
    });

    await handler.handleMessage(
      JSON.stringify({ type: 'connection_init', payload: { token: 'abc' } })
    );

    expect(seen).toEqual({ token: 'abc' });
  });

  it('closes 4403 when it returns false', async () => {
    const socket = new FakeSocket();
    const handler = makeHandler(socket, { onConnect: () => false });

    await handler.handleMessage(JSON.stringify({ type: 'connection_init' }));

    expect(socket.closedWith?.code).toBe(CloseCode.Forbidden);
  });

  it('closes 4403 when it throws, rather than leaking the error', async () => {
    const socket = new FakeSocket();
    const handler = makeHandler(socket, {
      onConnect: () => {
        throw new Error('token store unreachable');
      },
    });

    await handler.handleMessage(JSON.stringify({ type: 'connection_init' }));

    expect(socket.closedWith?.code).toBe(CloseCode.Forbidden);
    expect(socket.closedWith?.reason).toBe('Forbidden');
  });

  it('sends an object it returns as the connection_ack payload', async () => {
    const socket = new FakeSocket();
    const handler = makeHandler(socket, { onConnect: () => ({ userId: 'u1' }) });

    await handler.handleMessage(JSON.stringify({ type: 'connection_init' }));

    expect(await socket.next()).toEqual({
      type: 'connection_ack',
      payload: { userId: 'u1' },
    });
  });
});

describe('queries over the socket', () => {
  it('answers a query with next then complete', async () => {
    const { socket, handler } = await connected();

    await handler.handleMessage(
      JSON.stringify({ type: 'subscribe', id: '1', payload: { query: '{ hello }' } })
    );

    expect(await socket.next()).toEqual({ type: 'next', id: '1', payload: { data: { hello: 'world' } } });
    expect(await socket.next()).toEqual({ type: 'complete', id: '1' });
  });

  it('reports a resolver failure inside the next payload, not as a protocol error', async () => {
    const { socket, handler } = await connected();

    await handler.handleMessage(
      JSON.stringify({ type: 'subscribe', id: '1', payload: { query: '{ boom }' } })
    );

    const next = await socket.next();
    expect(next.type).toBe('next');
    expect(next.payload.errors[0].message).toBe('resolver exploded');
    expect((await socket.next()).type).toBe('complete');
  });

  it('sends error for a query that fails validation', async () => {
    const { socket, handler } = await connected();

    await handler.handleMessage(
      JSON.stringify({ type: 'subscribe', id: '1', payload: { query: '{ nope }' } })
    );

    const message = await socket.next();
    expect(message.type).toBe('error');
    expect(message.id).toBe('1');
    expect(message.payload[0].message).toContain('nope');
    // A failed operation must not also complete, and must not kill the socket.
    expect(socket.closedWith).toBeUndefined();
  });

  it('sends error for a query that will not parse', async () => {
    const { socket, handler } = await connected();

    await handler.handleMessage(
      JSON.stringify({ type: 'subscribe', id: '1', payload: { query: '{ broken' } })
    );

    expect((await socket.next()).type).toBe('error');
  });
});

describe('subscriptions', () => {
  it('streams published payloads as next messages', async () => {
    const { socket, handler } = await connected();

    await handler.handleMessage(
      JSON.stringify({ type: 'subscribe', id: 's1', payload: { query: 'subscription { messages }' } })
    );
    // Give subscribe() a turn to attach before publishing.
    await new Promise(r => setTimeout(r, 10));

    await pubsub.publish('MESSAGES', 'first');
    expect(await socket.next()).toEqual({
      type: 'next',
      id: 's1',
      payload: { data: { messages: 'first' } },
    });

    await pubsub.publish('MESSAGES', 'second');
    expect((await socket.next()).payload.data.messages).toBe('second');
  });

  it('stops the stream and detaches on complete', async () => {
    const { socket, handler } = await connected();

    await handler.handleMessage(
      JSON.stringify({ type: 'subscribe', id: 's1', payload: { query: 'subscription { messages }' } })
    );
    await new Promise(r => setTimeout(r, 10));
    expect(pubsub.subscriberCount('MESSAGES')).toBe(1);

    await handler.handleMessage(JSON.stringify({ type: 'complete', id: 's1' }));
    await new Promise(r => setTimeout(r, 10));

    expect(pubsub.subscriberCount('MESSAGES')).toBe(0);
    expect(handler.operationCount).toBe(0);

    // Nothing more is delivered for a stopped operation.
    await pubsub.publish('MESSAGES', 'ignored');
    await new Promise(r => setTimeout(r, 20));
    expect(socket.sent.filter(m => m.type === 'next')).toHaveLength(0);
  });

  it('closes 4409 on a duplicate operation id', async () => {
    const { socket, handler } = await connected();
    const subscribe = JSON.stringify({
      type: 'subscribe',
      id: 's1',
      payload: { query: 'subscription { messages }' },
    });

    await handler.handleMessage(subscribe);
    await handler.handleMessage(subscribe);

    expect(socket.closedWith?.code).toBe(CloseCode.SubscriberAlreadyExists);
  });

  it('runs two subscriptions independently on one socket', async () => {
    const { socket, handler } = await connected();

    for (const id of ['a', 'b']) {
      await handler.handleMessage(
        JSON.stringify({ type: 'subscribe', id, payload: { query: 'subscription { messages }' } })
      );
    }
    await new Promise(r => setTimeout(r, 10));
    expect(pubsub.subscriberCount('MESSAGES')).toBe(2);

    await pubsub.publish('MESSAGES', 'x');
    const ids = [(await socket.next()).id, (await socket.next()).id].sort();
    expect(ids).toEqual(['a', 'b']);

    await handler.handleMessage(JSON.stringify({ type: 'complete', id: 'a' }));
    await new Promise(r => setTimeout(r, 10));
    expect(pubsub.subscriberCount('MESSAGES')).toBe(1);
  });

  it('sends error when the subscription source cannot be created', async () => {
    const { socket, handler } = await connected();

    await handler.handleMessage(
      JSON.stringify({ type: 'subscribe', id: 's1', payload: { query: 'subscription { failing }' } })
    );

    const message = await socket.next();
    expect(message.type).toBe('error');
    expect(message.payload[0].message).toContain('cannot open stream');
  });

  it('close() ends every running operation, so nothing leaks', async () => {
    const { handler } = await connected();

    for (const id of ['a', 'b']) {
      await handler.handleMessage(
        JSON.stringify({ type: 'subscribe', id, payload: { query: 'subscription { messages }' } })
      );
    }
    await new Promise(r => setTimeout(r, 10));
    expect(pubsub.subscriberCount('MESSAGES')).toBe(2);

    handler.close();
    await new Promise(r => setTimeout(r, 10));

    expect(pubsub.subscriberCount('MESSAGES')).toBe(0);
    expect(handler.operationCount).toBe(0);
  });

  it('writes nothing to a socket that has already closed', async () => {
    const { socket, handler } = await connected();

    await handler.handleMessage(
      JSON.stringify({ type: 'subscribe', id: 's1', payload: { query: 'subscription { messages }' } })
    );
    await new Promise(r => setTimeout(r, 10));

    handler.close();
    socket.sent.length = 0;

    await pubsub.publish('MESSAGES', 'after-close');
    await new Promise(r => setTimeout(r, 20));

    expect(socket.sent).toHaveLength(0);
  });
});

describe('keepalive and malformed input', () => {
  it('answers ping with pong, echoing the payload', async () => {
    const { socket, handler } = await connected();

    await handler.handleMessage(JSON.stringify({ type: 'ping', payload: { t: 1 } }));

    expect(await socket.next()).toEqual({ type: 'pong', payload: { t: 1 } });
  });

  it('accepts an unsolicited pong', async () => {
    const { socket, handler } = await connected();

    await handler.handleMessage(JSON.stringify({ type: 'pong' }));

    expect(socket.closedWith).toBeUndefined();
  });

  it('closes 4400 on a message that is not JSON', async () => {
    const { socket, handler } = await connected();
    await handler.handleMessage('not json at all');
    expect(socket.closedWith?.code).toBe(CloseCode.BadRequest);
  });

  it('closes 4400 on a message with no type', async () => {
    const { socket, handler } = await connected();
    await handler.handleMessage(JSON.stringify({ id: '1' }));
    expect(socket.closedWith?.code).toBe(CloseCode.BadRequest);
  });

  it('closes 4400 on an unknown message type', async () => {
    const { socket, handler } = await connected();
    await handler.handleMessage(JSON.stringify({ type: 'start', id: '1' }));
    expect(socket.closedWith?.code).toBe(CloseCode.BadRequest);
  });

  it('closes 4400 when subscribe carries no query', async () => {
    const { socket, handler } = await connected();
    await handler.handleMessage(JSON.stringify({ type: 'subscribe', id: '1', payload: {} }));
    expect(socket.closedWith?.code).toBe(CloseCode.BadRequest);
  });

  it('closes 4400 when subscribe carries no id', async () => {
    const { socket, handler } = await connected();
    await handler.handleMessage(
      JSON.stringify({ type: 'subscribe', payload: { query: '{ hello }' } })
    );
    expect(socket.closedWith?.code).toBe(CloseCode.BadRequest);
  });

  it('reads a binary frame', async () => {
    const { socket, handler } = await connected();

    await handler.handleMessage(
      new TextEncoder().encode(JSON.stringify({ type: 'ping' })).buffer as ArrayBuffer
    );

    expect((await socket.next()).type).toBe('pong');
  });

  it('ignores complete for an id that is not running', async () => {
    const { socket, handler } = await connected();
    await handler.handleMessage(JSON.stringify({ type: 'complete', id: 'never-existed' }));
    expect(socket.closedWith).toBeUndefined();
  });
});

describe('server-side faults', () => {
  it('reports a schema that cannot be validated as an error, not a crash', async () => {
    // graphql's validate() *throws* on an invalid schema rather than returning
    // errors — a subscription-only schema has no Query root, which is illegal.
    // Escaping here would take down the process from inside a socket's message
    // handler.
    const { GraphQLSchema, GraphQLObjectType, GraphQLString } = graphql;
    const schemaWithoutQuery = new GraphQLSchema({
      subscription: new GraphQLObjectType({
        name: 'Subscription',
        fields: { ticks: { type: GraphQLString, subscribe: () => pubsub.subscribe('T') } },
      }),
    });

    const socket = new FakeSocket();
    const handler = new GraphQLWSHandler(socket, { schema: schemaWithoutQuery, graphql } as any);
    await handler.handleMessage(JSON.stringify({ type: 'connection_init' }));
    await socket.next();

    await handler.handleMessage(
      JSON.stringify({ type: 'subscribe', id: '1', payload: { query: 'subscription { ticks }' } })
    );

    const message = await socket.next();
    expect(message.type).toBe('error');
    expect(message.payload[0].message).toContain('Query root type');
  });
});

describe('context', () => {
  it('passes the context factory result to resolvers', async () => {
    const socket = new FakeSocket();
    const { GraphQLSchema, GraphQLObjectType, GraphQLString } = graphql;
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'Query',
        fields: {
          whoami: { type: GraphQLString, resolve: (_p: any, _a: any, ctx: any) => ctx.user },
        },
      }),
    });

    const handler = new GraphQLWSHandler(socket, {
      schema,
      graphql,
      context: (connection: any) => ({ user: connection.connectionParams?.token }),
    } as any);

    await handler.handleMessage(
      JSON.stringify({ type: 'connection_init', payload: { token: 'ada' } })
    );
    await socket.next();
    await handler.handleMessage(
      JSON.stringify({ type: 'subscribe', id: '1', payload: { query: '{ whoami }' } })
    );

    expect((await socket.next()).payload.data.whoami).toBe('ada');
  });
});
