#!/usr/bin/env node
/**
 * Prove GraphQL subscriptions work under plain Node, against the **official**
 * `graphql-ws` client.
 *
 * Two things are being checked at once, and the second is the important one:
 *
 *   1. The transport runs on Node, where upgrades go through `@hono/node-ws`.
 *   2. Veloce-TS's hand-written `graphql-transport-ws` server is protocol-
 *      correct. The unit tests drive it with a fake socket, which proves it is
 *      self-consistent but not that it interoperates. `graphql-ws` is the
 *      reference client — the one Apollo Client, urql and GraphiQL are built
 *      on — so if it is happy, real clients are too.
 *
 * Run against the built output: `node scripts/smoke-graphql-subscriptions.mjs`.
 */
import { WebSocket } from 'ws';
import { createClient } from 'graphql-ws';
import { createServer } from 'node:net';

// Everything comes from the built entrypoint — the surface a consumer imports.
const {
  Veloce,
  GraphQLPlugin,
  PubSub,
  Resolver,
  GQLQuery,
  GQLSubscription,
  Returns,
  WebSocketPlugin,
  WebSocket: WSDecorator,
  OnConnect,
  OnMessage,
} = await import('../dist/esm/src/index.js');

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} - ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
};

const pubsub = new PubSub();

class ChatResolver {
  ping() {
    return 'pong';
  }

  messageAdded() {
    return pubsub.subscribe('MESSAGE_ADDED');
  }

  countdown() {
    return (async function* () {
      for (let i = 3; i > 0; i--) yield String(i);
    })();
  }
}

// Decorators are applied manually: this file is plain JS, run straight off dist.
Resolver()(ChatResolver);
GQLQuery()(ChatResolver.prototype, 'ping');
Returns('String')(ChatResolver.prototype, 'ping');
GQLSubscription()(ChatResolver.prototype, 'messageAdded');
Returns('String')(ChatResolver.prototype, 'messageAdded');
GQLSubscription()(ChatResolver.prototype, 'countdown');
Returns('String')(ChatResolver.prototype, 'countdown');

/**
 * Refuse to run when something already holds the port.
 *
 * These scripts bind a literal port, so a stray server from an earlier run — or
 * a second copy of this script — answers the probes and the test reports on the
 * wrong process. That surfaces as an unexplained "timed out waiting for a
 * frame", which says nothing about the actual cause.
 */
async function assertPortFree(port) {
  const free = await new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '127.0.0.1');
  });

  if (!free) {
    console.error(
      `\n❌ Port ${port} is already in use. Stop whatever is listening before running this.\n`
    );
    process.exit(1);
  }
}

const PORT = 3211;
await assertPortFree(PORT);
const seen = { connected: 0, tokens: [] };

const app = new Veloce({ docs: false });
app.usePlugin(
  new GraphQLPlugin({
    resolvers: [ChatResolver],
    playground: false,
    subscriptions: {
      onConnect: ({ connectionParams }) => {
        seen.connected++;
        seen.tokens.push(connectionParams?.token);
        return connectionParams?.token !== 'denied';
      },
    },
  })
);

const server = await app.listen(PORT);
console.log(`\nGraphQL subscriptions smoke test (Node ${process.version})\n`);

/** One subscription, collected to completion or to `count` payloads. */
function collect(client, query, count) {
  return new Promise((resolve, reject) => {
    const values = [];
    const timer = setTimeout(
      () => reject(new Error(`timed out after ${values.length}/${count} payloads`)),
      5000
    );

    const dispose = client.subscribe(
      { query },
      {
        next: (result) => {
          values.push(result);
          if (values.length >= count) {
            clearTimeout(timer);
            dispose();
            resolve(values);
          }
        },
        error: (err) => {
          clearTimeout(timer);
          reject(err instanceof Error ? err : new Error(JSON.stringify(err)));
        },
        complete: () => {
          clearTimeout(timer);
          resolve(values);
        },
      }
    );
  });
}

function makeClient(connectionParams) {
  return createClient({
    url: `ws://127.0.0.1:${PORT}/graphql`,
    webSocketImpl: WebSocket,
    connectionParams,
    retryAttempts: 0,
  });
}

try {
  // --- 1. the official client completes the handshake -----------------------
  const client = makeClient({ token: 'valid' });

  const queryResults = await collect(client, '{ ping }', 1);
  check('graphql-ws client runs a query over the socket', queryResults[0]?.data?.ping === 'pong');
  check('onConnect saw the connectionParams', seen.tokens.includes('valid'));

  // --- 2. a generator subscription streams and completes --------------------
  const counted = await collect(client, 'subscription { countdown }', 3);
  check(
    'generator subscription streamed 3 payloads',
    counted.map((r) => r.data.countdown).join(',') === '3,2,1',
    counted.map((r) => r.data?.countdown).join(',')
  );

  // --- 3. a pubsub subscription receives published payloads -----------------
  const streaming = collect(client, 'subscription { messageAdded }', 2);
  // Give the subscribe round-trip time to attach before publishing.
  await new Promise((r) => setTimeout(r, 250));
  await pubsub.publish('MESSAGE_ADDED', 'first');
  await pubsub.publish('MESSAGE_ADDED', 'second');

  const streamed = await streaming;
  check(
    'pubsub subscription delivered both payloads',
    streamed.map((r) => r.data.messageAdded).join(',') === 'first,second',
    streamed.map((r) => r.data?.messageAdded).join(',')
  );

  // --- 4. unsubscribing detaches the source --------------------------------
  await new Promise((r) => setTimeout(r, 100));
  check(
    'unsubscribing detached the pubsub source',
    pubsub.subscriberCount('MESSAGE_ADDED') === 0,
    `${pubsub.subscriberCount('MESSAGE_ADDED')} left`
  );

  await client.dispose();

  // --- 5. onConnect can refuse a connection --------------------------------
  const denied = makeClient({ token: 'denied' });
  let refused = false;
  try {
    await collect(denied, '{ ping }', 1);
  } catch {
    refused = true;
  }
  check('onConnect refusal closes the connection', refused);
  await denied.dispose();

  // --- 6. a dropped socket does not leak -----------------------------------
  const dropper = makeClient({ token: 'valid' });
  const pending = collect(dropper, 'subscription { messageAdded }', 99).catch(() => {});
  await new Promise((r) => setTimeout(r, 300));
  const attached = pubsub.subscriberCount('MESSAGE_ADDED');
  await dropper.dispose();
  await new Promise((r) => setTimeout(r, 300));

  check('subscription was attached while the client was live', attached === 1, `${attached}`);
  check(
    'closing the socket detached it',
    pubsub.subscriberCount('MESSAGE_ADDED') === 0,
    `${pubsub.subscriberCount('MESSAGE_ADDED')} left`
  );
  await pending;
  // --- 7. both WebSocket plugins in one app --------------------------------
  //
  // On Node, WebSocketPlugin and the subscription endpoint both borrow
  // @hono/node-ws. Each createNodeWebSocket() attaches its own 'upgrade'
  // listener, and a listener that finds no waiter for a request ends the
  // socket — so two instances destroy each other's handshakes. They share one.
  await runCoexistenceCheck();
} catch (error) {
  check('smoke test ran to completion', false, error.message);
} finally {
  await app.shutdown();
  await server.close?.();
}

async function runCoexistenceCheck() {
  const COEXIST_PORT = 3212;
  await assertPortFree(COEXIST_PORT);
  const coexistPubSub = new PubSub();

  class EchoGateway {
    onMessage(connection, data) {
      connection.send({ type: 'echo', text: data?.text });
    }
  }
  WSDecorator('/ws')(EchoGateway);
  OnMessage()(EchoGateway.prototype, 'onMessage');

  class TickResolver {
    ticks() {
      return coexistPubSub.subscribe('TICK');
    }
  }
  Resolver()(TickResolver);
  GQLSubscription()(TickResolver.prototype, 'ticks');
  Returns('String')(TickResolver.prototype, 'ticks');

  const both = new Veloce({ docs: false });
  both.include(EchoGateway);
  both.usePlugin(new WebSocketPlugin());
  both.usePlugin(
    new GraphQLPlugin({ resolvers: [TickResolver], playground: false, subscriptions: true })
  );

  const bothServer = await both.listen(COEXIST_PORT);

  try {
    // The plain gateway still upgrades and echoes.
    const gateway = new WebSocket(`ws://127.0.0.1:${COEXIST_PORT}/ws`);
    const echoed = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('gateway never answered')), 5000);
      gateway.on('open', () => gateway.send(JSON.stringify({ text: 'hi' })));
      gateway.on('message', (data) => {
        clearTimeout(timer);
        resolve(JSON.parse(data.toString()));
      });
      gateway.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    check('gateway still works alongside subscriptions', echoed?.text === 'hi', JSON.stringify(echoed));
    gateway.close();

    // ...and so does the subscription endpoint, on the same server.
    const client = createClient({
      url: `ws://127.0.0.1:${COEXIST_PORT}/graphql`,
      webSocketImpl: WebSocket,
      retryAttempts: 0,
    });

    const streamed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('subscription never delivered')), 5000);
      const dispose = client.subscribe(
        { query: 'subscription { ticks }' },
        {
          next: (result) => {
            clearTimeout(timer);
            dispose();
            resolve(result);
          },
          error: (err) => {
            clearTimeout(timer);
            reject(err instanceof Error ? err : new Error(JSON.stringify(err)));
          },
          complete: () => {},
        }
      );
    });

    await new Promise((r) => setTimeout(r, 300));
    await coexistPubSub.publish('TICK', 'tock');

    const result = await streamed;
    check(
      'subscriptions still work alongside a gateway',
      result?.data?.ticks === 'tock',
      JSON.stringify(result?.data)
    );

    await client.dispose();
  } catch (error) {
    check('both WebSocket plugins coexist on one server', false, error.message);
  } finally {
    await both.shutdown();
    await bothServer.close?.();
  }
}

console.log(
  failures === 0
    ? '\n✅ GraphQL subscriptions work on Node, verified against the graphql-ws client\n'
    : `\n❌ ${failures} check(s) failed\n`
);

process.exit(failures === 0 ? 0 : 1);
