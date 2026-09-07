/**
 * @module veloce-ts/websocket/node-adapter
 * @description One shared `@hono/node-ws` instance per application.
 *
 * Node has no built-in upgrade path, so both `WebSocketPlugin` and the GraphQL
 * subscription endpoint borrow `@hono/node-ws`. They must borrow the *same*
 * one: each `createNodeWebSocket()` attaches its own `'upgrade'` listener to
 * the HTTP server, and on every upgrade a listener that finds no waiter for
 * that request ends the socket. Two instances would therefore destroy each
 * other's connections — whichever ran first would kill the other's handshake.
 */
import type { VeloceTS } from '../core/application.js';

/** The slice of `@hono/node-ws` used here. */
export interface NodeWebSocketAdapter {
  upgradeWebSocket: (handler: (c: any) => Record<string, unknown>) => any;
  injectWebSocket: (server: unknown) => void;
}

interface AdapterEntry {
  adapter: NodeWebSocketAdapter;
  injected: boolean;
}

const adapters = new WeakMap<object, AdapterEntry>();

/** True on any runtime that is not Bun or Deno. */
export function needsNodeWebSocketAdapter(): boolean {
  const global = globalThis as any;
  return typeof global.Bun === 'undefined' && typeof global.Deno === 'undefined';
}

/**
 * The application's `@hono/node-ws` instance, created on first use.
 *
 * Must be called before any route is registered on it: `upgradeWebSocket()`
 * returns the middleware that owns the route.
 *
 * @throws if `@hono/node-ws` is not installed, with the install command.
 */
export async function getNodeWebSocketAdapter(app: VeloceTS): Promise<NodeWebSocketAdapter> {
  const existing = adapters.get(app as unknown as object);
  if (existing) return existing.adapter;

  let createNodeWebSocket: (init: { app: any }) => NodeWebSocketAdapter;

  try {
    // Specifier in a variable: the package is an optional peer, so neither tsc
    // nor the bundler should try to resolve it at build time.
    const specifier = '@hono/node-ws';
    ({ createNodeWebSocket } = await import(specifier));
  } catch (error) {
    throw new Error(
      'WebSocket support on Node requires the @hono/node-ws package. ' +
      'Install it with: npm install @hono/node-ws\n' +
      '(Bun and Deno upgrade natively and need no extra package.)',
      { cause: error }
    );
  }

  const adapter = createNodeWebSocket({ app: app.getHono() });
  adapters.set(app as unknown as object, { adapter, injected: false });
  return adapter;
}

/**
 * Attach the adapter to the running HTTP server. Idempotent, so every plugin
 * that uses WebSockets can call it from its own `onStart` without the second
 * call adding a duplicate `'upgrade'` listener.
 *
 * @returns whether this call performed the injection
 */
export function injectNodeWebSocket(app: VeloceTS, server: unknown): boolean {
  const entry = adapters.get(app as unknown as object);
  if (!entry || entry.injected) return false;

  entry.adapter.injectWebSocket(server as any);
  entry.injected = true;
  return true;
}

/** Whether this application has already created an adapter. */
export function hasNodeWebSocketAdapter(app: VeloceTS): boolean {
  return adapters.has(app as unknown as object);
}
