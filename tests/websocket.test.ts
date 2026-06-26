import 'reflect-metadata';
import { describe, it, expect } from 'bun:test';
import { Veloce, WebSocketPlugin, WebSocket, OnConnect, OnMessage, OnDisconnect } from 'veloce-ts';

describe('WebSocket decorators', () => {
  it('@WebSocket decorator is a valid class decorator', () => {
    expect(() => {
      @WebSocket('/ws/chat')
      class ChatGateway {}
      return ChatGateway;
    }).not.toThrow();
  });

  it('@OnConnect attaches to method without error', () => {
    expect(() => {
      class GatewayA {
        @OnConnect()
        handleConnect() {}
      }
      return GatewayA;
    }).not.toThrow();
  });

  it('@OnMessage attaches to method without error', () => {
    expect(() => {
      class GatewayB {
        @OnMessage()
        handleMessage() {}
      }
      return GatewayB;
    }).not.toThrow();
  });

  it('@OnDisconnect attaches to method without error', () => {
    expect(() => {
      class GatewayC {
        @OnDisconnect()
        handleDisconnect() {}
      }
      return GatewayC;
    }).not.toThrow();
  });

  it('all three event decorators on same class', () => {
    expect(() => {
      class FullGateway {
        @OnConnect() onConn() {}
        @OnMessage() onMsg() {}
        @OnDisconnect() onDisconn() {}
      }
      return FullGateway;
    }).not.toThrow();
  });
});

describe('WebSocketPlugin', () => {
  it('constructs without error on Bun', () => {
    expect(() => new WebSocketPlugin()).not.toThrow();
  });

  it('has correct plugin name and version', () => {
    const plugin = new WebSocketPlugin();
    expect(plugin.name).toBe('websocket');
    expect(plugin.version).toBe('1.0.0');
  });

  it('usePlugin() accepts WebSocketPlugin without error', () => {
    const app = new Veloce({ docs: false });
    expect(() => app.usePlugin(new WebSocketPlugin())).not.toThrow();
  });

  it('compiles with a @WebSocket gateway and registers upgrade route', async () => {
    @WebSocket('/ws/room-compile-test')
    class RoomGateway {
      @OnConnect() onConn() {}
      @OnMessage() onMsg() {}
    }

    const app = new Veloce({ docs: false });
    app.include(RoomGateway as any);
    app.usePlugin(new WebSocketPlugin());
    await app.compile();

    const hono = app.getHono();
    // Non-upgrade GET → 426 (expects WebSocket upgrade), not 404
    const res = await hono.fetch(new Request('http://localhost/ws/room-compile-test'));
    expect(res.status).toBe(426);
  });

  it('returns 401 when authorizeUpgrade() returns false', async () => {
    @WebSocket('/ws/secure-auth-test')
    class SecureGateway {
      @OnConnect() onConn() {}
      authorizeUpgrade() { return false; }
    }

    const app = new Veloce({ docs: false });
    app.include(SecureGateway as any);
    app.usePlugin(new WebSocketPlugin());
    await app.compile();

    const hono = app.getHono();
    const res = await hono.fetch(
      new Request('http://localhost/ws/secure-auth-test', {
        headers: { Upgrade: 'websocket', Connection: 'Upgrade' }
      })
    );
    expect(res.status).toBe(401);
  });

  it('returns 426 for non-upgrade request when no authorizeUpgrade defined', async () => {
    @WebSocket('/ws/open-test')
    class OpenGateway {
      @OnConnect() onConn() {}
    }

    const app = new Veloce({ docs: false });
    app.include(OpenGateway as any);
    app.usePlugin(new WebSocketPlugin());
    await app.compile();

    const hono = app.getHono();
    const res = await hono.fetch(new Request('http://localhost/ws/open-test'));
    expect(res.status).toBe(426);
  });
});
