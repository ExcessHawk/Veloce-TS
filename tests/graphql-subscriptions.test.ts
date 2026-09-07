/**
 * GraphQL subscriptions end to end: a real server, a real WebSocket client,
 * and the graphql-transport-ws handshake.
 *
 * Subscriptions were generated into the SDL but had no execution transport, so
 * subscribing did nothing. These are the tests that would have caught that.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { z } from 'zod';
import { VeloceTS } from '../src/core/application';
import { GraphQLPlugin } from '../src/graphql/plugin';
import { PubSub } from '../src/graphql/pubsub';
import { Resolver, GQLQuery, GQLSubscription, Arg } from '../src/decorators/graphql';
import { Returns } from '../src/graphql/returns';
import { GRAPHQL_TRANSPORT_WS_PROTOCOL, CloseCode } from '../src/graphql/ws-protocol';

const MessageSchema = z.object({ room: z.string(), text: z.string() });

let pubsub: PubSub;

@Resolver()
class ChatResolver {
  @GQLQuery()
  @Returns('String')
  ping() {
    return 'pong';
  }

  @GQLSubscription()
  @Returns(MessageSchema, { name: 'ChatMessage' })
  messageAdded() {
    return pubsub.subscribe('MESSAGE_ADDED');
  }

  @GQLSubscription()
  @Returns('String')
  countdown(@Arg('from', z.number()) from: number) {
    return (async function* () {
      for (let i = from; i > 0; i--) yield String(i);
    })();
  }

  /** Returns a plain value — the framework should say so, clearly. */
  @GQLSubscription()
  @Returns('String')
  notAStream() {
    return 'oops' as any;
  }
}

/** Minimal graphql-transport-ws client over the platform WebSocket. */
class TestClient {
  private socket!: WebSocket;
  private queue: any[] = [];
  private waiters: Array<(m: any) => void> = [];
  closeEvent?: CloseEvent;

  static async connect(port: number, path = '/graphql', protocol: string | undefined = GRAPHQL_TRANSPORT_WS_PROTOCOL) {
    const client = new TestClient();
    client.socket = protocol
      ? new WebSocket(`ws://127.0.0.1:${port}${path}`, protocol)
      : new WebSocket(`ws://127.0.0.1:${port}${path}`);

    client.socket.onmessage = (event: MessageEvent) => {
      const message = JSON.parse(String(event.data));
      const waiter = client.waiters.shift();
      if (waiter) waiter(message);
      else client.queue.push(message);
    };
    client.socket.onclose = (event: CloseEvent) => {
      client.closeEvent = event;
    };

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('socket never opened')), 3000);
      client.socket.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      client.socket.onerror = () => {
        clearTimeout(timer);
        reject(new Error('socket errored while connecting'));
      };
    });

    return client;
  }

  get protocol(): string {
    return this.socket.protocol;
  }

  send(message: Record<string, unknown>): void {
    this.socket.send(JSON.stringify(message));
  }

  next(timeoutMs = 3000): Promise<any> {
    if (this.queue.length > 0) return Promise.resolve(this.queue.shift());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for a frame')), timeoutMs);
      this.waiters.push(message => {
        clearTimeout(timer);
        resolve(message);
      });
    });
  }

  /** connection_init + connection_ack. */
  async handshake(payload?: Record<string, unknown>): Promise<any> {
    this.send({ type: 'connection_init', ...(payload ? { payload } : {}) });
    return this.next();
  }

  async waitForClose(timeoutMs = 3000): Promise<CloseEvent> {
    const started = Date.now();
    while (!this.closeEvent) {
      if (Date.now() - started > timeoutMs) throw new Error('socket never closed');
      await new Promise(r => setTimeout(r, 10));
    }
    return this.closeEvent;
  }

  close(): void {
    try {
      this.socket.close();
    } catch {
      /* already gone */
    }
  }
}

async function startApp(subscriptions: any = true) {
  const app = new VeloceTS({ docs: false });
  const plugin = new GraphQLPlugin({
    resolvers: [ChatResolver],
    playground: false,
    subscriptions,
  });
  app.usePlugin(plugin);

  const server = await app.listen(0);
  return { app, plugin, port: server.port as number };
}

let running: { app: VeloceTS; plugin: GraphQLPlugin; port: number } | undefined;
let clients: TestClient[] = [];

beforeEach(() => {
  pubsub = new PubSub();
});

afterEach(async () => {
  for (const client of clients) client.close();
  clients = [];
  if (running) {
    await running.app.shutdown();
    running = undefined;
  }
  // Let the sockets finish closing before the next test binds a port.
  await new Promise(r => setTimeout(r, 20));
});

async function connect(path?: string, protocol?: string | undefined) {
  const client = await TestClient.connect(running!.port, path, protocol);
  clients.push(client);
  return client;
}

describe('subscription transport', () => {
  it('negotiates the graphql-transport-ws subprotocol', async () => {
    running = await startApp();
    const client = await connect();

    // A browser aborts the connection when the server does not echo the
    // subprotocol it offered, so this is not cosmetic.
    expect(client.protocol).toBe(GRAPHQL_TRANSPORT_WS_PROTOCOL);
  });

  it('acknowledges connection_init', async () => {
    running = await startApp();
    const client = await connect();

    expect(await client.handshake()).toEqual({ type: 'connection_ack' });
  });

  it('streams published payloads to the client', async () => {
    running = await startApp();
    const client = await connect();
    await client.handshake();

    client.send({
      type: 'subscribe',
      id: '1',
      payload: { query: 'subscription { messageAdded { room text } }' },
    });
    await new Promise(r => setTimeout(r, 50));

    await pubsub.publish('MESSAGE_ADDED', { room: 'general', text: 'hello' });

    expect(await client.next()).toEqual({
      type: 'next',
      id: '1',
      payload: { data: { messageAdded: { room: 'general', text: 'hello' } } },
    });
  });

  it('delivers several payloads in order', async () => {
    running = await startApp();
    const client = await connect();
    await client.handshake();

    client.send({
      type: 'subscribe',
      id: '1',
      payload: { query: 'subscription { messageAdded { text } }' },
    });
    await new Promise(r => setTimeout(r, 50));

    for (const text of ['one', 'two', 'three']) {
      await pubsub.publish('MESSAGE_ADDED', { room: 'r', text });
    }

    const received: string[] = [];
    for (let i = 0; i < 3; i++) {
      received.push((await client.next()).payload.data.messageAdded.text);
    }
    expect(received).toEqual(['one', 'two', 'three']);
  });

  it('runs a generator subscription to completion', async () => {
    running = await startApp();
    const client = await connect();
    await client.handshake();

    client.send({
      type: 'subscribe',
      id: '1',
      payload: { query: 'subscription { countdown(from: 3) }' },
    });

    const values: string[] = [];
    for (let i = 0; i < 3; i++) {
      values.push((await client.next()).payload.data.countdown);
    }
    expect(values).toEqual(['3', '2', '1']);
    expect(await client.next()).toEqual({ type: 'complete', id: '1' });
  });

  it('validates subscription arguments with the Zod schema', async () => {
    running = await startApp();
    const client = await connect();
    await client.handshake();

    client.send({
      type: 'subscribe',
      id: '1',
      payload: { query: 'subscription { countdown(from: "three") }' },
    });

    const message = await client.next();
    expect(message.type).toBe('error');
  });

  it('answers a plain query over the socket too', async () => {
    running = await startApp();
    const client = await connect();
    await client.handshake();

    client.send({ type: 'subscribe', id: '1', payload: { query: '{ ping }' } });

    expect((await client.next()).payload.data.ping).toBe('pong');
    expect((await client.next()).type).toBe('complete');
  });

  it('names the resolver when a subscription does not return a stream', async () => {
    running = await startApp();
    const client = await connect();
    await client.handshake();

    client.send({
      type: 'subscribe',
      id: '1',
      payload: { query: 'subscription { notAStream }' },
    });

    const message = await client.next();
    expect(message.type).toBe('error');
    expect(message.payload[0].message).toContain('notAStream');
    expect(message.payload[0].message).toContain('async iterable');
  });

  it('stops the stream when the client completes', async () => {
    running = await startApp();
    const client = await connect();
    await client.handshake();

    client.send({
      type: 'subscribe',
      id: '1',
      payload: { query: 'subscription { messageAdded { text } }' },
    });
    await new Promise(r => setTimeout(r, 50));
    expect(pubsub.subscriberCount('MESSAGE_ADDED')).toBe(1);

    client.send({ type: 'complete', id: '1' });
    await new Promise(r => setTimeout(r, 50));

    expect(pubsub.subscriberCount('MESSAGE_ADDED')).toBe(0);
  });

  it('detaches the stream when the socket drops', async () => {
    running = await startApp();
    const client = await connect();
    await client.handshake();

    client.send({
      type: 'subscribe',
      id: '1',
      payload: { query: 'subscription { messageAdded { text } }' },
    });
    await new Promise(r => setTimeout(r, 50));
    expect(pubsub.subscriberCount('MESSAGE_ADDED')).toBe(1);

    // No `complete`, just a dead socket — the case that leaks if close is
    // not wired to the transport.
    client.close();
    await new Promise(r => setTimeout(r, 100));

    expect(pubsub.subscriberCount('MESSAGE_ADDED')).toBe(0);
    expect(running.plugin.connectionCount).toBe(0);
  });

  it('serves POST queries on the same path', async () => {
    running = await startApp();

    const response = await fetch(`http://127.0.0.1:${running.port}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ ping }' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { ping: 'pong' } });
  });
});

describe('subscription authorization', () => {
  it('refuses the connection with 4403 when onConnect returns false', async () => {
    running = await startApp({ onConnect: () => false });
    const client = await connect();

    client.send({ type: 'connection_init', payload: { token: 'bad' } });

    expect((await client.waitForClose()).code).toBe(CloseCode.Forbidden);
  });

  it('accepts the connection when onConnect approves the token', async () => {
    running = await startApp({
      onConnect: ({ connectionParams }: any) => connectionParams?.token === 'good',
    });
    const client = await connect();

    expect(await client.handshake({ token: 'good' })).toEqual({ type: 'connection_ack' });
  });

  it('exposes connectionParams to resolvers through the context factory', async () => {
    running = await startApp({
      context: ({ connectionParams }: any) => ({ user: connectionParams?.user }),
    });
    const client = await connect();
    await client.handshake({ user: 'ada' });

    // The context reaches execution; ping ignores it, but a failure to build
    // the context would have closed the socket before the ack.
    client.send({ type: 'subscribe', id: '1', payload: { query: '{ ping }' } });
    expect((await client.next()).payload.data.ping).toBe('pong');
  });

  it('closes 4401 when subscribe arrives before connection_init', async () => {
    running = await startApp();
    const client = await connect();

    client.send({ type: 'subscribe', id: '1', payload: { query: '{ ping }' } });

    expect((await client.waitForClose()).code).toBe(CloseCode.Unauthorized);
  });
});

describe('subscription lifecycle', () => {
  it('shutdown() ends every open subscription', async () => {
    running = await startApp();
    const client = await connect();
    await client.handshake();

    client.send({
      type: 'subscribe',
      id: '1',
      payload: { query: 'subscription { messageAdded { text } }' },
    });
    await new Promise(r => setTimeout(r, 50));
    expect(pubsub.subscriberCount('MESSAGE_ADDED')).toBe(1);
    expect(running.plugin.connectionCount).toBe(1);

    await running.app.shutdown();
    running = undefined;
    await new Promise(r => setTimeout(r, 50));

    expect(pubsub.subscriberCount('MESSAGE_ADDED')).toBe(0);
  });

  it('is off unless asked for — a GET without upgrade is not hijacked', async () => {
    const app = new VeloceTS({ docs: false });
    app.usePlugin(new GraphQLPlugin({ resolvers: [ChatResolver], playground: false }));
    const server = await app.listen(0);

    const response = await fetch(
      `http://127.0.0.1:${server.port}/graphql?query=${encodeURIComponent('{ ping }')}`
    );
    expect(await response.json()).toEqual({ data: { ping: 'pong' } });

    await app.shutdown();
  });

  it('still answers GET queries when subscriptions share the path', async () => {
    running = await startApp();

    const response = await fetch(
      `http://127.0.0.1:${running.port}/graphql?query=${encodeURIComponent('{ ping }')}`
    );
    expect(await response.json()).toEqual({ data: { ping: 'pong' } });
  });
});

describe('generated schema', () => {
  it('declares the Subscription type in the SDL', async () => {
    running = await startApp();
    const sdl = running.plugin.getSchema()!.typeDefs;

    expect(sdl).toContain('type Subscription {');
    expect(sdl).toContain('messageAdded: ChatMessage!');
    expect(sdl).toContain('countdown(from: Float!): String!');
  });

  it('emits a Query root even when nothing declares a query', async () => {
    // GraphQL requires a query root on every schema. Without this, a
    // resolver set of subscriptions alone produced a schema whose first
    // operation died with "Query root type must be provided" — an error that
    // points nowhere near the cause.
    @Resolver()
    class SubscriptionsOnly {
      @GQLSubscription()
      @Returns('String')
      ticks() {
        return pubsub.subscribe('TICK');
      }
    }

    const app = new VeloceTS({ docs: false });
    const plugin = new GraphQLPlugin({
      resolvers: [SubscriptionsOnly],
      playground: false,
      subscriptions: true,
    });
    app.usePlugin(plugin);
    const server = await app.listen(0);

    expect(plugin.getSchema()!.typeDefs).toContain('type Query {');

    const response = await fetch(`http://127.0.0.1:${server.port}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ __schema { subscriptionType { name } } }' }),
    });
    const body: any = await response.json();
    expect(body.data.__schema.subscriptionType.name).toBe('Subscription');

    await app.shutdown();
  });

  it('exposes subscriptions through introspection', async () => {
    running = await startApp();

    const response = await fetch(`http://127.0.0.1:${running.port}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: '{ __schema { subscriptionType { fields { name } } } }',
      }),
    });

    const body: any = await response.json();
    const names = body.data.__schema.subscriptionType.fields.map((f: any) => f.name);
    expect(names).toContain('messageAdded');
  });
});
