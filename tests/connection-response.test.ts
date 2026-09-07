/**
 * WebSocketConnection and the file-serving responses.
 *
 * Both were rewritten in 3.x and both had almost no coverage: the connection
 * wrapper sat at 2.8%, and `Response.file`'s new `root` containment — the thing
 * standing between a route parameter and `../../etc/passwd` — had none at all.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { WebSocketConnection, type WebSocketLike } from '../src/websocket/connection';
import { WebSocketManager } from '../src/websocket/manager';
import { Response as VeloceResponse, FileResponse } from '../src/responses/response';

// ─── WebSocketConnection ─────────────────────────────────────────────────────

/** Records what was sent, and lets a test drive `readyState`. */
class FakeSocket implements WebSocketLike {
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

describe('WebSocketConnection', () => {
  let socket: FakeSocket;
  let manager: WebSocketManager;
  let connection: WebSocketConnection;

  beforeEach(() => {
    socket = new FakeSocket();
    manager = new WebSocketManager({ heartbeatIntervalMs: 0 });
    connection = new WebSocketConnection(socket, manager);
  });

  it('assigns an id, and honours one supplied explicitly', () => {
    expect(connection.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new WebSocketConnection(socket, manager, 'fixed').id).toBe('fixed');
  });

  it('serialises objects and passes strings through untouched', () => {
    connection.send({ type: 'hello' });
    connection.send('raw');
    expect(socket.sent).toEqual(['{"type":"hello"}', 'raw']);
  });

  it('drops sends once the socket is no longer open', () => {
    socket.readyState = 3;
    connection.send({ ignored: true });
    expect(socket.sent).toHaveLength(0);
  });

  it('does not depend on a global WebSocket constant', () => {
    // `WebSocket.OPEN` only became stable in Node 22; reading it on Node 20
    // threw a ReferenceError. Removing the global proves we no longer touch it.
    const original = (globalThis as any).WebSocket;
    // @ts-expect-error — deliberately removing the global for this assertion
    delete (globalThis as any).WebSocket;
    try {
      expect(() => connection.send({ ok: true })).not.toThrow();
      expect(connection.isOpen).toBe(true);
    } finally {
      (globalThis as any).WebSocket = original;
    }
  });

  it('isOpen tracks readyState, and false once marked closed', () => {
    expect(connection.isOpen).toBe(true);
    socket.readyState = 2; // CLOSING
    expect(connection.isOpen).toBe(false);

    socket.readyState = 1;
    connection._markClosed();
    expect(connection.isOpen).toBe(false);
    expect(connection.native).toBeNull();
  });

  it('close() forwards the code and reason', () => {
    connection.close(1001, 'going away');
    expect(socket.closedWith).toEqual({ code: 1001, reason: 'going away' });
  });

  it('close() is a no-op on an already-closed socket', () => {
    socket.readyState = 3;
    connection.close(1000);
    expect(socket.closedWith).toBeNull();
  });

  it('requestUrl reads Bun\'s ws.data, then falls back to ws.url, then empty', () => {
    (socket as any).data = { requestUrl: 'ws://host/chat?room=1' };
    expect(connection.requestUrl).toBe('ws://host/chat?room=1');

    delete (socket as any).data;
    (socket as any).url = 'ws://host/fallback';
    expect(connection.requestUrl).toBe('ws://host/fallback');

    delete (socket as any).url;
    expect(connection.requestUrl).toBe('');

    connection._markClosed();
    expect(connection.requestUrl).toBe('');
  });

  it('join/leave delegate to the manager and update room membership', () => {
    manager.openConnection(socket, { target: class {}, path: '/ws' } as any);
    const tracked = manager.getAllConnections()[0];

    tracked.join('lobby');
    expect(manager.getRooms()).toContain('lobby');
    expect(manager.getRoomSize('lobby')).toBe(1);

    tracked.leave('lobby');
    expect(manager.getRoomSize('lobby')).toBe(0);
  });

  it('broadcast reaches other connections in the room', () => {
    const metadata = { target: class {}, path: '/ws' } as any;
    const first = new FakeSocket();
    const second = new FakeSocket();
    const a = manager.openConnection(first, metadata);
    const b = manager.openConnection(second, metadata);
    a.join('room');
    b.join('room');

    a.broadcast({ hello: true }, 'room');

    expect(second.sent).toContain('{"hello":true}');
  });
});

// ─── File responses ──────────────────────────────────────────────────────────

describe('FileResponse root containment', () => {
  let dir: string;
  let uploads: string;

  /** Minimal Hono-ish context: only what FileResponse touches. */
  const fakeContext = () => {
    const captured: { status?: number; body?: unknown; json?: unknown } = {};
    return {
      captured,
      c: {
        body: (value: unknown, status: number, headers: Record<string, string>) => {
          captured.status = status;
          captured.body = value;
          return { status, headers };
        },
        json: (value: unknown, status: number) => {
          captured.status = status;
          captured.json = value;
          return { status, value };
        },
      } as any,
    };
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'veloce-files-'));
    uploads = join(dir, 'uploads');
    mkdirSync(uploads);
    writeFileSync(join(uploads, 'report.txt'), 'public content');
    writeFileSync(join(dir, 'secret.txt'), 'SHOULD NOT LEAK');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('serves a file inside the root', async () => {
    const { c, captured } = fakeContext();
    await new FileResponse('report.txt', { root: uploads }).toHonoResponse(c);
    expect(captured.status).toBe(200);
  });

  it('refuses a traversal out of the root with 403', async () => {
    const { c, captured } = fakeContext();
    await new FileResponse('../secret.txt', { root: uploads }).toHonoResponse(c);

    expect(captured.status).toBe(403);
    expect(captured.json).toMatchObject({ error: 'Forbidden' });
  });

  it('refuses a deeper traversal too', async () => {
    const { c, captured } = fakeContext();
    await new FileResponse('../../../../etc/passwd', { root: uploads }).toHonoResponse(c);
    expect(captured.status).toBe(403);
  });

  it('404s a missing file inside the root, rather than 403', async () => {
    const { c, captured } = fakeContext();
    await new FileResponse('absent.txt', { root: uploads }).toHonoResponse(c);
    expect(captured.status).toBe(404);
  });

  it('Response.fileFrom() builds a root-confined response', async () => {
    const response = VeloceResponse.fileFrom(uploads, '../secret.txt');
    expect(response).toBeInstanceOf(FileResponse);

    const { c, captured } = fakeContext();
    await response.toHonoResponse(c);
    expect(captured.status).toBe(403);
  });

  it('without a root, no containment is applied', async () => {
    // The historical behaviour: the caller is trusted to build the path.
    const { c, captured } = fakeContext();
    await new FileResponse(join(dir, 'secret.txt')).toHonoResponse(c);
    expect(captured.status).toBe(200);
  });
});
