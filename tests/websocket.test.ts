import 'reflect-metadata';
import { describe, it, expect } from 'bun:test';
import {
  Veloce,
  WebSocketPlugin,
  WebSocket,
  OnConnect,
  OnMessage,
  OnDisconnect,
  WebSocketManager,
  DIContainer
} from 'veloce-ts';

/**
 * Minimal WebSocket stand-in used to unit-test WebSocketManager without a
 * real network socket. Implements just enough of the native WebSocket shape
 * (readyState/send/close) for WebSocketConnection to drive it.
 * Note: `WebSocket` is shadowed above by the `@WebSocket` gateway decorator
 * import, so readyState codes are hardcoded (1 = OPEN, 3 = CLOSED) per the
 * WHATWG WebSocket spec instead of referencing the constants directly.
 */
class FakeWS {
  readyState = 1; // OPEN
  sent: string[] = [];
  closedWith: { code?: number; reason?: string } | null = null;

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closedWith = { code, reason };
    this.readyState = 3; // CLOSED
  }
}

/** Await a short real-time delay for the timer-based hardening tests. */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

describe('WebSocketManager hardening: max message size', () => {
  it('rejects an oversized inbound message with an error frame and closes with 1009', async () => {
    const manager = new WebSocketManager({
      maxMessageSizeBytes: 10,
      heartbeatIntervalMs: 0,
      idleTimeoutMs: 0
    });
    const fakeWs = new FakeWS();
    const metadata: any = { target: class {}, path: '/ws/oversize' };
    const connection = manager.openConnection(fakeWs as any, metadata);

    await manager.handleMessage(
      { data: 'x'.repeat(50) } as MessageEvent,
      connection,
      metadata
    );

    expect(fakeWs.closedWith?.code).toBe(1009);
    const errorFrame = fakeWs.sent.map((s) => JSON.parse(s)).find((m) => m.error);
    expect(errorFrame?.error).toBe('Message too large');
    expect(manager.getConnectionCount()).toBe(0);
  });

  it('accepts a message within the configured size limit', async () => {
    const manager = new WebSocketManager({
      maxMessageSizeBytes: 1024,
      heartbeatIntervalMs: 0,
      idleTimeoutMs: 0
    });
    const fakeWs = new FakeWS();
    const metadata: any = { target: class {}, path: '/ws/ok-size' };
    const connection = manager.openConnection(fakeWs as any, metadata);

    await manager.handleMessage(
      { data: JSON.stringify({ hello: 'world' }) } as MessageEvent,
      connection,
      metadata
    );

    expect(fakeWs.closedWith).toBeNull();
    expect(manager.getConnectionCount()).toBe(1);
  });
});

describe('WebSocketManager hardening: idle timeout', () => {
  it('closes an idle connection after idleTimeoutMs with no inbound messages', async () => {
    const manager = new WebSocketManager({ idleTimeoutMs: 30, heartbeatIntervalMs: 0 });
    const fakeWs = new FakeWS();
    const metadata: any = { target: class {}, path: '/ws/idle' };
    manager.openConnection(fakeWs as any, metadata);

    await wait(70);

    expect(fakeWs.closedWith?.code).toBe(1001);
    expect(fakeWs.closedWith?.reason).toBe('Idle timeout');
    expect(manager.getConnectionCount()).toBe(0);
  });

  it('re-arms the idle timer on inbound activity, delaying the close', async () => {
    const manager = new WebSocketManager({ idleTimeoutMs: 30, heartbeatIntervalMs: 0 });
    const fakeWs = new FakeWS();
    const metadata: any = { target: class {}, path: '/ws/idle-touch' };
    const connection = manager.openConnection(fakeWs as any, metadata);

    await wait(20);
    // Any inbound frame counts as activity and re-arms the idle timer.
    await manager.handleMessage({ data: JSON.stringify({ ping: true }) } as MessageEvent, connection, metadata);

    await wait(20);
    // 20ms since the touch — still under the 30ms idle threshold.
    expect(fakeWs.closedWith).toBeNull();

    await wait(35);
    // Now well past 30ms since the last touch — connection should be closed.
    expect(fakeWs.closedWith?.code).toBe(1001);
    expect(manager.getConnectionCount()).toBe(0);
  });

  it('never closes connections when idleTimeoutMs is left disabled (default)', async () => {
    const manager = new WebSocketManager({ heartbeatIntervalMs: 0 });
    const fakeWs = new FakeWS();
    const metadata: any = { target: class {}, path: '/ws/idle-off' };
    manager.openConnection(fakeWs as any, metadata);

    await wait(50);

    expect(fakeWs.closedWith).toBeNull();
    expect(manager.getConnectionCount()).toBe(1);
  });
});

describe('WebSocketManager hardening: heartbeat', () => {
  it('sends periodic ping frames while the connection stays alive', async () => {
    const manager = new WebSocketManager({
      heartbeatIntervalMs: 15,
      heartbeatTimeoutMs: 1000, // large so it never trips during this test
      idleTimeoutMs: 0
    });
    const fakeWs = new FakeWS();
    const metadata: any = { target: class {}, path: '/ws/ping' };
    const connection = manager.openConnection(fakeWs as any, metadata);

    await wait(40);

    const pingFrame = fakeWs.sent.map((s) => JSON.parse(s)).find((m) => m.type === 'ping');
    expect(pingFrame).toBeDefined();
    expect(fakeWs.closedWith).toBeNull();

    // heartbeatTimeoutMs is intentionally large for this assertion — clean up
    // the still-running heartbeat interval explicitly instead of leaving it
    // to fire in the background for the rest of the test run.
    manager.handleDisconnect(connection, metadata);
  });

  it('closes a connection that misses heartbeatTimeoutMs with no inbound traffic', async () => {
    const manager = new WebSocketManager({
      heartbeatIntervalMs: 15,
      heartbeatTimeoutMs: 30,
      idleTimeoutMs: 0
    });
    const fakeWs = new FakeWS();
    const metadata: any = { target: class {}, path: '/ws/heartbeat-timeout' };
    manager.openConnection(fakeWs as any, metadata);

    await wait(90);

    expect(fakeWs.closedWith?.code).toBe(1001);
    expect(fakeWs.closedWith?.reason).toBe('Heartbeat timeout');
    expect(manager.getConnectionCount()).toBe(0);
  });

  it('treats an inbound pong frame as liveness, keeping the connection open', async () => {
    // Generous margins on purpose: with a tight timeout (e.g. 45ms) ordinary
    // scheduling jitter under a loaded test run can push the "still open"
    // assertion past the deadline and fail intermittently.
    const manager = new WebSocketManager({
      heartbeatIntervalMs: 25,
      heartbeatTimeoutMs: 400,
      idleTimeoutMs: 0
    });
    const fakeWs = new FakeWS();
    const metadata: any = { target: class {}, path: '/ws/pong-keepalive', onMessage: 'onMsg', instance: { onMsg: () => {} } };
    const connection = manager.openConnection(fakeWs as any, metadata);

    await wait(30);
    await manager.handleMessage(
      { data: JSON.stringify({ type: 'pong' }) } as MessageEvent,
      connection,
      metadata
    );

    await wait(60);
    // ~60ms since the pong — far under the 400ms timeout, so still open.
    expect(fakeWs.closedWith).toBeNull();

    await wait(500);
    // >400ms since the pong with no further activity — now closed.
    expect(fakeWs.closedWith?.code).toBe(1001);
    expect(fakeWs.closedWith?.reason).toBe('Heartbeat timeout');
  });

  it('does not forward ping/pong control frames to the @OnMessage handler', async () => {
    let calls = 0;
    const manager = new WebSocketManager({ heartbeatIntervalMs: 15, idleTimeoutMs: 0 });
    const fakeWs = new FakeWS();
    const metadata: any = {
      target: class {},
      path: '/ws/no-forward',
      onMessage: 'onMsg',
      instance: { onMsg: () => { calls++; } }
    };
    const connection = manager.openConnection(fakeWs as any, metadata);

    await manager.handleMessage({ data: JSON.stringify({ type: 'ping' }) } as MessageEvent, connection, metadata);
    await manager.handleMessage({ data: JSON.stringify({ type: 'pong' }) } as MessageEvent, connection, metadata);

    expect(calls).toBe(0);
    // The server replies to an inbound app-level ping with a pong.
    const replies = fakeWs.sent.map((s) => JSON.parse(s));
    expect(replies.some((m) => m.type === 'pong')).toBe(true);

    manager.handleDisconnect(connection, metadata); // stop the background heartbeat timer
  });
});

describe('WebSocketManager hardening: DI resolution', () => {
  it('resolves gateway handler instances through the DI container instead of bypassing it with `new`', async () => {
    class Counter {
      count = 0;
    }
    class InjectedGateway {
      constructor(private counter: Counter) {
        // A container-bypassing `new metadata.target()` call would invoke
        // this constructor with no arguments, leaving `counter` undefined.
        if (!(this.counter instanceof Counter)) {
          throw new Error('DI bypass: counter dependency was not injected');
        }
      }
      onConnect(): void {
        this.counter.count++;
      }
    }

    const container = new DIContainer();
    const sharedCounter = new Counter();
    container.register(InjectedGateway, {
      scope: 'singleton',
      factory: () => new InjectedGateway(sharedCounter)
    });

    const manager = new WebSocketManager({ heartbeatIntervalMs: 0, idleTimeoutMs: 0 });
    manager.setContainer(container);

    const fakeWs = new FakeWS();
    const metadata: any = { target: InjectedGateway, path: '/ws/injected', onConnect: 'onConnect' };
    manager.openConnection(fakeWs as any, metadata);

    // openConnection fires the onConnect handler without awaiting it.
    await wait(10);

    expect(sharedCounter.count).toBe(1);
    expect(metadata.instance).toBeInstanceOf(InjectedGateway);
  });

  it('caches the resolved instance on metadata so a gateway is only constructed once', async () => {
    let constructions = 0;
    class TrackedGateway {
      constructor() {
        constructions++;
      }
      onConnect(): void {}
      onDisconnect(): void {}
    }

    const container = new DIContainer();
    container.register(TrackedGateway, { scope: 'singleton' });

    const manager = new WebSocketManager({ heartbeatIntervalMs: 0, idleTimeoutMs: 0 });
    manager.setContainer(container);

    const metadata: any = {
      target: TrackedGateway,
      path: '/ws/tracked',
      onConnect: 'onConnect',
      onDisconnect: 'onDisconnect'
    };

    const wsA = new FakeWS();
    const connA = manager.openConnection(wsA as any, metadata);
    await wait(10);
    manager.handleDisconnect(connA, metadata);

    const wsB = new FakeWS();
    manager.openConnection(wsB as any, metadata);
    await wait(10);

    expect(constructions).toBe(1);
  });
});
