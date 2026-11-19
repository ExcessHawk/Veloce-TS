/**
 * @module veloce-ts/middleware/client-ip
 * @description {@link clientIp}: the address of the client that sent a request, resolved
 * in a way a client cannot forge.
 */
import type { Context } from '../types/index.js';

export interface ClientIpOptions {
  /**
   * How many reverse proxies you control sit in front of the application.
   *
   * - `0` (default): the app is reached directly. `X-Forwarded-For` is entirely
   *   client-controlled and is ignored; the transport peer address is used.
   * - `N > 0`: each trusted proxy appends the address it received the request
   *   from, so the client's address is the Nth entry counted from the RIGHT of
   *   `X-Forwarded-For`. Entries further left were supplied by the client and
   *   are never read.
   *
   * Set it to the real number of hops (1 behind a single load balancer). Too
   * high lets a client choose its own address; too low yields a proxy's address.
   */
  trustedProxyHops?: number;
}

/**
 * Address of the transport peer (the socket's other end), or `undefined` when
 * the runtime does not expose it — e.g. requests injected in tests through
 * `app.getHono().request()`.
 *
 * Resolved structurally from what each adapter puts in `c.env`, so no
 * runtime-specific module has to be imported (importing `hono/bun` under Node
 * throws at load time).
 */
export function peerAddress(c: Context): string | undefined {
  const env = c.env as any;
  if (!env) return undefined;

  // Bun: the server instance is passed as env (or as env.server)
  const bunServer = typeof env.requestIP === 'function' ? env : env.server;
  if (bunServer && typeof bunServer.requestIP === 'function') {
    try {
      const info = bunServer.requestIP(c.req.raw);
      if (info?.address) return info.address;
    } catch {
      // not a request this server knows about — fall through
    }
  }

  // Node (@hono/node-server): the IncomingMessage
  const nodeAddress = env.incoming?.socket?.remoteAddress;
  if (typeof nodeAddress === 'string' && nodeAddress) return nodeAddress;

  // Deno: Deno.ServeHandlerInfo
  const denoAddress = env.remoteAddr?.hostname;
  if (typeof denoAddress === 'string' && denoAddress) return denoAddress;

  return undefined;
}

/**
 * The client's IP address.
 *
 * Anchored on the transport peer, and reads `X-Forwarded-For` only at the
 * position written by a proxy you declared as trusted — never the leftmost
 * entry, which is whatever the client typed.
 *
 * @returns the address, or `undefined` when it cannot be determined.
 *
 * @example
 * ```ts
 * clientIp(c);                              // direct exposure: the socket peer
 * clientIp(c, { trustedProxyHops: 1 });     // behind one load balancer
 * ```
 */
export function clientIp(c: Context, options: ClientIpOptions = {}): string | undefined {
  const hops = Math.max(0, Math.floor(options.trustedProxyHops ?? 0));

  if (hops > 0) {
    const forwarded = c.req.header('x-forwarded-for');
    if (forwarded) {
      const chain = forwarded.split(',').map((part) => part.trim()).filter(Boolean);
      const entry = chain[chain.length - hops];
      if (entry) return entry;
    }
  }

  return peerAddress(c);
}
