/**
 * Session tests — MemorySessionStore
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { MemorySessionStore } from '../src/auth/session';
import type { SessionData } from '../src/auth/session';

function makeSession(overrides: Partial<SessionData> = {}): SessionData {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    userId: 'user-1',
    data: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('MemorySessionStore – basic CRUD', () => {
  let store: MemorySessionStore;

  beforeEach(() => {
    // Large interval so cleanup timer doesn't fire during tests
    store = new MemorySessionStore(999_999);
  });

  afterEach(() => {
    clearInterval((store as any).cleanupTimer);
  });

  it('get returns null for non-existent session', async () => {
    expect(await store.get('nonexistent')).toBeNull();
  });

  it('set then get returns session data', async () => {
    const session = makeSession({ data: { theme: 'dark' } });
    await store.set(session.id, session);
    const retrieved = await store.get(session.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.data).toEqual({ theme: 'dark' });
    expect(retrieved!.userId).toBe('user-1');
  });

  it('set overwrites existing session', async () => {
    const session = makeSession({ data: { v: 1 } });
    await store.set(session.id, session);
    const updated = { ...session, data: { v: 2 }, updatedAt: new Date() };
    await store.set(session.id, updated);
    const retrieved = await store.get(session.id);
    expect(retrieved!.data).toEqual({ v: 2 });
  });

  it('destroy removes session', async () => {
    const session = makeSession();
    await store.set(session.id, session);
    await store.destroy(session.id);
    expect(await store.get(session.id)).toBeNull();
  });

  it('destroy on non-existent session does not throw', async () => {
    await expect(store.destroy('ghost')).resolves.toBeUndefined();
  });

  it('length returns count of stored sessions', async () => {
    await store.set('s1', makeSession());
    await store.set('s2', makeSession());
    expect(await store.length()).toBe(2);
  });

  it('all returns all sessions', async () => {
    const s1 = makeSession();
    const s2 = makeSession();
    await store.set(s1.id, s1);
    await store.set(s2.id, s2);
    const all = await store.all();
    expect(all.length).toBe(2);
    const ids = all.map(s => s.id);
    expect(ids).toContain(s1.id);
    expect(ids).toContain(s2.id);
  });

  it('clear removes all sessions', async () => {
    await store.set('c1', makeSession());
    await store.set('c2', makeSession());
    await store.clear();
    expect(await store.length()).toBe(0);
    expect(await store.all()).toEqual([]);
  });
});

describe('MemorySessionStore – touch', () => {
  let store: MemorySessionStore;

  beforeEach(() => {
    store = new MemorySessionStore(999_999);
  });

  afterEach(() => {
    clearInterval((store as any).cleanupTimer);
  });

  it('touch updates updatedAt on existing session', async () => {
    const session = makeSession();
    const originalUpdatedAt = session.updatedAt;
    await store.set(session.id, session);
    await new Promise(r => setTimeout(r, 10)); // Ensure time advances
    await store.touch(session.id);
    const retrieved = await store.get(session.id);
    expect(retrieved!.updatedAt.getTime()).toBeGreaterThanOrEqual(originalUpdatedAt.getTime());
  });

  it('touch on non-existent session does not throw', async () => {
    await expect(store.touch('ghost')).resolves.toBeUndefined();
  });
});

describe('MemorySessionStore – expiry', () => {
  let store: MemorySessionStore;

  beforeEach(() => {
    store = new MemorySessionStore(999_999);
  });

  afterEach(() => {
    clearInterval((store as any).cleanupTimer);
  });

  it('session with past expiresAt returns null on get', async () => {
    const session = makeSession({
      expiresAt: new Date(Date.now() - 1000), // already expired
    });
    await store.set(session.id, session);
    expect(await store.get(session.id)).toBeNull();
  });

  it('expired session is removed from store on get', async () => {
    const session = makeSession({
      expiresAt: new Date(Date.now() - 1000),
    });
    await store.set(session.id, session);
    await store.get(session.id); // triggers removal
    expect(await store.length()).toBe(0);
  });

  it('session with future expiresAt is still accessible', async () => {
    const session = makeSession({
      expiresAt: new Date(Date.now() + 60_000), // 1 minute from now
    });
    await store.set(session.id, session);
    expect(await store.get(session.id)).not.toBeNull();
  });

  it('session without expiresAt never expires', async () => {
    const session = makeSession(); // no expiresAt
    await store.set(session.id, session);
    // Should still be there
    expect(await store.get(session.id)).not.toBeNull();
  });

  it('real TTL expiry: returns null after 1s', async () => {
    const session = makeSession({
      expiresAt: new Date(Date.now() + 1000), // 1 second
    });
    await store.set(session.id, session);
    // Should be accessible immediately
    expect(await store.get(session.id)).not.toBeNull();
    // Wait for expiry
    await new Promise(r => setTimeout(r, 1100));
    expect(await store.get(session.id)).toBeNull();
  });
});

describe('MemorySessionStore – multiple sessions independence', () => {
  let store: MemorySessionStore;

  beforeEach(() => {
    store = new MemorySessionStore(999_999);
  });

  afterEach(() => {
    clearInterval((store as any).cleanupTimer);
  });

  it('destroying one session does not affect others', async () => {
    const s1 = makeSession({ userId: 'u1' });
    const s2 = makeSession({ userId: 'u2' });
    await store.set(s1.id, s1);
    await store.set(s2.id, s2);
    await store.destroy(s1.id);
    expect(await store.get(s2.id)).not.toBeNull();
    expect(await store.get(s1.id)).toBeNull();
  });

  it('sessions for different users are independent', async () => {
    const s1 = makeSession({ userId: 'user-A', data: { role: 'admin' } });
    const s2 = makeSession({ userId: 'user-B', data: { role: 'viewer' } });
    await store.set(s1.id, s1);
    await store.set(s2.id, s2);
    expect((await store.get(s1.id))!.data.role).toBe('admin');
    expect((await store.get(s2.id))!.data.role).toBe('viewer');
  });
});
