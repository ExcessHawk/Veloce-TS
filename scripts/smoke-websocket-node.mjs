#!/usr/bin/env node
/**
 * Prove that a `@WebSocket` gateway really works under plain Node.
 *
 * Until 3.2.0 `WebSocketPlugin` threw at startup on Node, so this whole surface
 * was Bun/Deno-only — the template smoke test had to skip booting the websocket
 * templates for exactly that reason. This exercises the real path: HTTP upgrade,
 * gateway lifecycle hooks, echo, rooms and broadcast.
 *
 * Run against the built output: `node scripts/smoke-websocket-node.mjs`.
 */
import { WebSocket } from 'ws';

// Everything comes from the built entrypoint — the bundle does not emit a file
// per source module, and this is the surface a consumer actually imports.
const {
  Veloce,
  WebSocketPlugin,
  WebSocket: WSDecorator,
  OnConnect,
  OnMessage,
  OnDisconnect,
} = await import('../dist/esm/src/index.js');

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} - ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
};

const seen = { connected: 0, disconnected: 0, messages: [] };

class ChatGateway {
  onConnect(connection) {
    seen.connected++;
    connection.join('lobby');
    connection.send({ type: 'welcome', id: connection.id });
  }

  async onMessage(connection, data) {
    seen.messages.push(data);
    if (data?.type === 'broadcast') {
      connection.broadcast({ type: 'announcement', text: data.text }, 'lobby');
      return;
    }
    connection.send({ type: 'echo', text: data?.text });
  }

  onDisconnect() {
    seen.disconnected++;
  }
}

// Decorators are applied manually: this file is plain JS, run straight off dist.
WSDecorator('/ws')(ChatGateway);
OnConnect()(ChatGateway.prototype, 'onConnect');
OnMessage()(ChatGateway.prototype, 'onMessage');
OnDisconnect()(ChatGateway.prototype, 'onDisconnect');

const PORT = 3210;
const app = new Veloce({ docs: false });
app.include(ChatGateway);
// Heartbeat off: this test asserts messaging, and a 30s ping would only add noise.
const plugin = new WebSocketPlugin({ heartbeatIntervalMs: 0 });
app.usePlugin(plugin);

await app.compile();
const server = await app.listen(PORT);

/**
 * Open a socket that buffers every frame from the moment it exists.
 *
 * Attaching a listener only after `open` resolves loses any frame the server
 * sends immediately on connect — `@OnConnect` does exactly that, and the first
 * version of this test hung waiting for a welcome it had already dropped.
 */
function open(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const queue = [];
    let waiting = null;

    socket.on('message', (raw) => {
      let parsed;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        parsed = raw.toString();
      }
      if (waiting) {
        const { resolve: r, timer } = waiting;
        waiting = null;
        clearTimeout(timer);
        r(parsed);
      } else {
        queue.push(parsed);
      }
    });

    /** Next frame, from the buffer if one already arrived. */
    socket.next = (timeoutMs = 5000) =>
      new Promise((r, rej) => {
        if (queue.length > 0) return r(queue.shift());
        const timer = setTimeout(
          () => rej(new Error('timed out waiting for a frame')),
          timeoutMs
        );
        waiting = { resolve: r, timer };
      });

    const openTimer = setTimeout(() => reject(new Error('timed out opening socket')), 5000);
    socket.once('open', () => { clearTimeout(openTimer); resolve(socket); });
    socket.once('error', (err) => { clearTimeout(openTimer); reject(err); });
  });
}

try {
  // 1. Upgrade + onConnect
  const alice = await open(`ws://127.0.0.1:${PORT}/ws`);
  const welcome = await alice.next();
  check('client completes the WebSocket upgrade', alice.readyState === WebSocket.OPEN);
  check('@OnConnect runs and can send', welcome?.type === 'welcome', JSON.stringify(welcome));

  // 2. Echo through @OnMessage
  alice.send(JSON.stringify({ type: 'say', text: 'hello' }));
  const echo = await alice.next();
  check('@OnMessage receives parsed JSON and replies', echo?.text === 'hello', JSON.stringify(echo));

  // 3. Rooms + broadcast reach a second client
  const bob = await open(`ws://127.0.0.1:${PORT}/ws`);
  await bob.next(); // bob's own welcome

  const bobHears = bob.next();
  alice.send(JSON.stringify({ type: 'broadcast', text: 'to the lobby' }));
  const announcement = await bobHears;
  check('broadcast to a room reaches another client', announcement?.text === 'to the lobby',
    JSON.stringify(announcement));

  // 4. Disconnect bookkeeping
  alice.close();
  bob.close();
  await new Promise((r) => setTimeout(r, 500));
  check('@OnDisconnect runs for both clients', seen.disconnected === 2, `saw ${seen.disconnected}`);
  check('manager drops both connections', plugin.getConnectionCount() === 0,
    `${plugin.getConnectionCount()} left`);
} catch (error) {
  console.error('  FAIL - ' + error.message);
  failures++;
} finally {
  await server.close();
}

console.log(failures === 0
  ? '\nWebSockets work under Node.'
  : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
