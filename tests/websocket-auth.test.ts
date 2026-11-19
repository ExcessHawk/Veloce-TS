/**
 * WebSocket gateways: declarative authentication, what the connection knows
 * about its client, one-time tickets, session termination, per-connection
 * rate limiting — all through the in-process test client.
 */
import { describe, it, expect } from 'bun:test';
import 'reflect-metadata';
import type { Context } from 'hono';
import { VeloceTS } from '../src/core/application';
import { WebSocket as Gateway, OnConnect, OnMessage, OnDisconnect } from '../src/decorators/websocket';
import { WebSocketPlugin, type WebSocketPluginConfig } from '../src/websocket/plugin';
import type { WebSocketConnection, WebSocketGateway } from '../src/websocket/connection';
import { CLOSE_UNAUTHENTICATED } from '../src/websocket/manager';
import { AuthPlugin } from '../src/auth/auth-plugin';
import { RBACPlugin } from '../src/auth/rbac-plugin';
import { InMemoryUserProvider } from '../src/auth/auth-service';
import { JWTProvider } from '../src/auth/jwt-provider';
import { TestClient } from '../src/testing/test-client';

const SECRET = 'test-secret-key-32chars-minimum!!';

async function build(
  gateways: any[],
  opts: { ws?: WebSocketPluginConfig; roles?: Record<string, string[]>; rbac?: boolean; setup?: (app: VeloceTS) => void } = {}
) {
  const userProvider = new InMemoryUserProvider();
  const users = opts.roles ?? { alice: ['member'] };
  for (const [username, roles] of Object.entries(users)) {
    await userProvider.createUser({ username, password: 'secret1', roles });
  }
  const auth = new AuthPlugin({ jwt: { secret: SECRET }, userProvider, enableDefaultRoutes: false });
  const plugin = new WebSocketPlugin({ heartbeatIntervalMs: 0, ...opts.ws });

  const app = new VeloceTS({ docs: false });
  app.usePlugin(auth);
  if (opts.rbac) {
    app.usePlugin(new RBACPlugin({
      useDefaults: false,
      enableManagementRoutes: false,
      roles: [
        { name: 'owner', permissions: ['*'], level: 100, inherits: ['member'] },
        { name: 'member', permissions: [], level: 10 },
      ],
    }));
  }
  app.usePlugin(plugin);
  for (const g of gateways) app.include(g);
  opts.setup?.(app);
  await app.compile();

  const tokenOf = async (name: string) =>
    (await auth.getAuthService().login(name, 'secret1')).tokens.accessToken;

  return { app, plugin, client: new TestClient(app), tokenOf };
}

describe('@WebSocket(path, { auth: true })', () => {
  @Gateway('/ws/private', { auth: true })
  class PrivateGateway {
    @OnConnect()
    onConnect(conn: WebSocketConnection) {
      conn.send({ type: 'welcome', sub: conn.user?.sub, username: (conn.user as any)?.username });
    }

    @OnMessage()
    onMessage(conn: WebSocketConnection, data: any) {
      conn.send({ type: 'echo', data, from: conn.user?.sub });
    }
  }

  it('refuses an anonymous upgrade with 401', async () => {
    const { client } = await build([PrivateGateway]);
    await expect(client.ws('/ws/private')).rejects.toMatchObject({ status: 401 });
  });

  it('refuses an invalid token with 401', async () => {
    const { client } = await build([PrivateGateway]);
    await expect(client.withToken('not-a-jwt').ws('/ws/private')).rejects.toMatchObject({ status: 401 });
  });

  it('accepts an authenticated client and exposes the user on the connection', async () => {
    const { client, tokenOf } = await build([PrivateGateway]);
    const ws = await client.withToken(await tokenOf('alice')).ws('/ws/private');

    const welcome = await ws.nextMessage();
    expect(welcome.type).toBe('welcome');
    expect(typeof welcome.sub).toBe('string');
    expect(ws.connection.user?.sub).toBe(welcome.sub);

    await ws.send({ hello: 'world' });
    expect(await ws.nextMessage()).toEqual({ type: 'echo', data: { hello: 'world' }, from: welcome.sub });
    await ws.close();
  });

  it('a gateway without options stays open to anonymous clients', async () => {
    @Gateway('/ws/open')
    class OpenGateway {
      @OnConnect()
      onConnect(conn: WebSocketConnection) {
        conn.send({ anonymous: conn.user === undefined });
      }
    }
    const { client } = await build([OpenGateway]);
    const ws = await client.ws('/ws/open');
    expect(await ws.nextMessage()).toEqual({ anonymous: true });
  });

  it('fails at startup when a gateway needs auth and nothing can verify credentials', async () => {
    const app = new VeloceTS({ docs: false });
    app.usePlugin(new WebSocketPlugin({ heartbeatIntervalMs: 0 }));
    app.include(PrivateGateway);
    await expect(app.compile()).rejects.toThrow(/requires authentication/);
  });
});

describe('authorizeUpgrade', () => {
  @Gateway('/ws/room', { auth: true })
  class RoomGateway implements WebSocketGateway<{ room: string }> {
    authorizeUpgrade(c: Context) {
      const room = c.req.query('room');
      if (!room) return false;
      if (room === 'forbidden') throw new Error('boom');
      // The framework has already authenticated the caller
      if (!c.get('auth.user')) return false;
      return { room };
    }

    @OnConnect()
    onConnect(conn: WebSocketConnection<{ room: string }>) {
      conn.join(conn.data.room);
      conn.send({ joined: conn.data.room });
    }
  }

  it('its returned object becomes connection.data', async () => {
    const { client, tokenOf } = await build([RoomGateway]);
    const ws = await client.withToken(await tokenOf('alice')).ws('/ws/room', { query: { room: 'general' } });
    expect(ws.connection.data).toEqual({ room: 'general' });
    expect(await ws.nextMessage()).toEqual({ joined: 'general' });
  });

  it('returning false refuses the upgrade', async () => {
    const { client, tokenOf } = await build([RoomGateway]);
    await expect(client.withToken(await tokenOf('alice')).ws('/ws/room')).rejects.toMatchObject({ status: 401 });
  });

  it('throwing refuses the upgrade instead of crashing', async () => {
    const { client, tokenOf } = await build([RoomGateway]);
    await expect(
      client.withToken(await tokenOf('alice')).ws('/ws/room', { query: { room: 'forbidden' } })
    ).rejects.toMatchObject({ status: 401 });
  });

  it('is not reached when the framework check already failed', async () => {
    let called = 0;
    @Gateway('/ws/guarded', { auth: true })
    class Guarded {
      authorizeUpgrade() { called++; return true; }
    }
    const { client } = await build([Guarded]);
    await expect(client.ws('/ws/guarded')).rejects.toMatchObject({ status: 401 });
    expect(called).toBe(0);
  });
});

describe('@WebSocket roles', () => {
  @Gateway('/ws/owners', { roles: ['owner'] })
  class OwnersGateway {
    @OnConnect()
    onConnect(conn: WebSocketConnection) { conn.send({ ok: true }); }
  }

  @Gateway('/ws/members', { roles: ['member'] })
  class MembersGateway {
    @OnConnect()
    onConnect(conn: WebSocketConnection) { conn.send({ ok: true }); }
  }

  const users = { alice: ['member'], olivia: ['owner'] };

  it('403 without the role, 401 without credentials', async () => {
    const { client, tokenOf } = await build([OwnersGateway], { roles: users });
    await expect(client.ws('/ws/owners')).rejects.toMatchObject({ status: 401 });
    await expect(client.withToken(await tokenOf('alice')).ws('/ws/owners')).rejects.toMatchObject({ status: 403 });
    const ws = await client.withToken(await tokenOf('olivia')).ws('/ws/owners');
    expect(await ws.nextMessage()).toEqual({ ok: true });
  });

  it('uses the RBAC plugin (role inheritance) when it is installed', async () => {
    // owner inherits member, so an owner may open a members-only gateway
    const { client, tokenOf } = await build([MembersGateway], { roles: users, rbac: true });
    const ws = await client.withToken(await tokenOf('olivia')).ws('/ws/members');
    expect(await ws.nextMessage()).toEqual({ ok: true });
  });
});

describe('connection tickets', () => {
  @Gateway('/ws/tick', { auth: true })
  class TicketGateway {
    @OnConnect()
    onConnect(conn: WebSocketConnection) { conn.send({ sub: conn.user?.sub }); }
  }

  const withTickets = { ws: { auth: {} } };

  it('no ticket endpoint exists unless auth is configured on the plugin', async () => {
    const { client, tokenOf } = await build([TicketGateway]);
    const res = await client.withToken(await tokenOf('alice')).post('/ws/ticket');
    expect(res.status).toBe(404);
  });

  it('issues a ticket only to an authenticated caller', async () => {
    const { client, tokenOf } = await build([TicketGateway], withTickets);
    expect((await client.post('/ws/ticket')).status).toBe(401);

    const res = await client.withToken(await tokenOf('alice')).post('/ws/ticket');
    expect(res.status).toBe(200);
    expect(typeof res.body.ticket).toBe('string');
    expect(res.body.ticket.length).toBeGreaterThanOrEqual(32);
    expect(res.body.expiresInMs).toBeGreaterThan(0);
  });

  it('a ticket opens a connection without any token in the request, once', async () => {
    const { client, tokenOf } = await build([TicketGateway], withTickets);
    const { ticket } = (await client.withToken(await tokenOf('alice')).post('/ws/ticket')).body;

    const ws = await client.ws('/ws/tick', { query: { ticket } });
    expect(typeof (await ws.nextMessage()).sub).toBe('string');

    // Single use
    await expect(client.ws('/ws/tick', { query: { ticket } })).rejects.toMatchObject({ status: 401 });
  });

  it('an expired ticket is refused', async () => {
    const { client, tokenOf } = await build([TicketGateway], { ws: { auth: { ticket: { ttlMs: 5 } } } });
    const { ticket } = (await client.withToken(await tokenOf('alice')).post('/ws/ticket')).body;
    await new Promise((r) => setTimeout(r, 20));
    await expect(client.ws('/ws/tick', { query: { ticket } })).rejects.toMatchObject({ status: 401 });
  });

  it('a made-up ticket is refused', async () => {
    const { client } = await build([TicketGateway], withTickets);
    await expect(client.ws('/ws/tick', { query: { ticket: 'f'.repeat(64) } })).rejects.toMatchObject({ status: 401 });
  });

  it('the token in the query string is refused unless the `query` source is enabled', async () => {
    const off = await build([TicketGateway], withTickets);
    const token = await off.tokenOf('alice');
    await expect(off.client.ws('/ws/tick', { query: { token } })).rejects.toMatchObject({ status: 401 });

    const on = await build([TicketGateway], { ws: { auth: { sources: ['query'] } } });
    const ws = await on.client.ws('/ws/tick', { query: { token: await on.tokenOf('alice') } });
    expect(typeof (await ws.nextMessage()).sub).toBe('string');
  });
});

describe('session lifetime', () => {
  @Gateway('/ws/live', { auth: true })
  class LiveGateway {
    static disconnects = 0;

    @OnDisconnect()
    onDisconnect() { LiveGateway.disconnects++; }
  }

  it('disconnectUser closes every connection of that user and no one else', async () => {
    LiveGateway.disconnects = 0;
    const { client, plugin, tokenOf } = await build([LiveGateway], { roles: { alice: ['member'], bob: ['member'] } });

    const a1 = await client.withToken(await tokenOf('alice')).ws('/ws/live');
    const a2 = await client.withToken(await tokenOf('alice')).ws('/ws/live');
    const b1 = await client.withToken(await tokenOf('bob')).ws('/ws/live');

    const closed = plugin.getManager().disconnectUser(String(a1.connection.user!.sub));

    expect(closed).toBe(2);
    expect(a1.closed).toBe(true);
    expect(a2.closed).toBe(true);
    expect(a1.closeCode).toBe(CLOSE_UNAUTHENTICATED);
    expect(b1.closed).toBe(false);
    expect(LiveGateway.disconnects).toBe(2);
    expect(plugin.getManager().getUserConnections(String(b1.connection.user!.sub))).toHaveLength(1);
  });

  it('closes the connection when the token it was opened with expires', async () => {
    // A token that expires almost immediately, verified by a plugin-level verifier
    const jwt = new JWTProvider({ secret: SECRET, expiresIn: '1s' });
    const { client } = await build([LiveGateway], {
      ws: { auth: { sources: ['query'], verifyToken: (t) => jwt.verifyAccessToken(t) } },
    });
    const { accessToken } = jwt.generateTokens({ sub: 'u-1', roles: ['member'] });

    const ws = await client.ws('/ws/live', { query: { token: accessToken } });
    expect(ws.closed).toBe(false);

    await new Promise((r) => setTimeout(r, 1300));
    expect(ws.closed).toBe(true);
    expect(ws.closeCode).toBe(CLOSE_UNAUTHENTICATED);
    expect(ws.closeReason).toBe('Token expired');
  });

  it('closeOnTokenExpiry: false leaves the connection open', async () => {
    @Gateway('/ws/sticky', { auth: true, closeOnTokenExpiry: false })
    class Sticky {}

    const jwt = new JWTProvider({ secret: SECRET, expiresIn: '1s' });
    const { client } = await build([Sticky], {
      ws: { auth: { sources: ['query'], verifyToken: (t) => jwt.verifyAccessToken(t) } },
    });
    const { accessToken } = jwt.generateTokens({ sub: 'u-1', roles: ['member'] });
    const ws = await client.ws('/ws/sticky', { query: { token: accessToken } });

    await new Promise((r) => setTimeout(r, 1300));
    expect(ws.closed).toBe(false);
  });
});

describe('per-connection rate limit', () => {
  @Gateway('/ws/limited', { rateLimit: { max: 2, windowMs: 60_000 } })
  class Limited {
    @OnMessage()
    onMessage(conn: WebSocketConnection, data: any) { conn.send({ got: data.n }); }
  }

  it('drops messages over the limit and says so, per connection', async () => {
    const { client } = await build([Limited]);
    const first = await client.ws('/ws/limited');
    const second = await client.ws('/ws/limited');

    await first.send({ n: 1 });
    await first.send({ n: 2 });
    await first.send({ n: 3 });

    expect(first.messages.slice(0, 2)).toEqual([{ got: 1 }, { got: 2 }]);
    expect(first.messages[2].error).toBe('Rate limit exceeded');
    expect(first.closed).toBe(false);

    // Another connection has its own budget
    await second.send({ n: 1 });
    expect(second.messages).toEqual([{ got: 1 }]);
  });
});

describe('gateway routes sit behind global middleware', () => {
  it("an 'afterPlugins' middleware runs for the upgrade request and sees the user", async () => {
    @Gateway('/ws/mw', { auth: true })
    class G {}

    let seen: string | undefined;
    const { client, tokenOf } = await build([G], {
      setup: (app) => {
        app.use(async (c, next) => {
          if (c.req.path === '/ws/mw') seen = String(c.get('auth.user')?.sub ?? 'anonymous');
          await next();
        }, { phase: 'afterPlugins' });
      },
    });

    await client.withToken(await tokenOf('alice')).ws('/ws/mw');
    expect(seen).toBeDefined();
    expect(seen).not.toBe('anonymous');
  });
});

describe('TestClient.ws', () => {
  it('explains what is missing when the WebSocket plugin is not installed', async () => {
    const app = new VeloceTS({ docs: false });
    await app.compile();
    await expect(new TestClient(app).ws('/ws/x')).rejects.toThrow(/WebSocketPlugin/);
  });

  it('nextMessage rejects after its timeout when nothing arrives', async () => {
    @Gateway('/ws/silent')
    class Silent {}
    const { client } = await build([Silent]);
    const ws = await client.ws('/ws/silent');
    await expect(ws.nextMessage(30)).rejects.toThrow(/No WebSocket message/);
  });

  it('the test-socket header alone cannot open a connection', async () => {
    @Gateway('/ws/hdr')
    class Hdr {}
    const { app } = await build([Hdr]);
    // Not registered by any pending in-process connect: falls through to the
    // real upgrade path, which this in-process request cannot complete.
    const res = await app.getHono().request('/ws/hdr', {
      headers: { Upgrade: 'websocket', 'x-veloce-test-socket': 'guess' },
    });
    expect(res.status).not.toBe(200);
  });
});
