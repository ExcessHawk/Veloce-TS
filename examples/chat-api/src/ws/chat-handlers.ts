/**
 * WebSocket runtime: JWT user (from Bun upgrade data), rooms aligned with REST /rooms,
 * messages persisted to SQLite and broadcast to all sockets in the same room.
 */
import { z } from 'zod';
import { db } from '../db';

export type ChatWsData = {
  userId: string;
  username: string;
};

const JoinSchema = z.object({
  type: z.literal('join'),
  roomId: z.string().uuid(),
});

const ChatMessageSchema = z.object({
  type: z.literal('message'),
  roomId: z.string().uuid(),
  content: z.string().min(1).max(2000),
});

const LeaveSchema = z.object({
  type: z.literal('leave'),
  roomId: z.string().uuid(),
});

const IncomingSchema = z.discriminatedUnion('type', [JoinSchema, ChatMessageSchema, LeaveSchema]);

/** Bun ServerWebSocket — typed loosely for tests without full Bun types */
type Ws = { send(data: string): void; data: ChatWsData; readyState: number };

const OPEN = 1;

const roomSockets = new Map<string, Set<Ws>>();
const socketRoom = new WeakMap<Ws, string>();

function roomExists(roomId: string): boolean {
  return Boolean(db.query('SELECT 1 FROM rooms WHERE id = ?').get(roomId));
}

function leaveRoom(ws: Ws): void {
  const roomId = socketRoom.get(ws);
  if (!roomId) return;
  const set = roomSockets.get(roomId);
  if (set) {
    set.delete(ws);
    if (set.size === 0) roomSockets.delete(roomId);
  }
  socketRoom.delete(ws);
}

function joinRoom(ws: Ws, roomId: string): { ok: true } | { ok: false; error: string } {
  if (!roomExists(roomId)) {
    return { ok: false, error: `Room "${roomId}" not found` };
  }
  leaveRoom(ws);
  if (!roomSockets.has(roomId)) {
    roomSockets.set(roomId, new Set());
  }
  roomSockets.get(roomId)!.add(ws);
  socketRoom.set(ws, roomId);
  return { ok: true };
}

function broadcastRoom(roomId: string, payload: unknown, except?: Ws): void {
  const set = roomSockets.get(roomId);
  if (!set) return;
  const text = JSON.stringify(payload);
  for (const client of set) {
    if (client === except) continue;
    if (client.readyState === OPEN) {
      client.send(text);
    }
  }
}

function fetchRecentMessages(roomId: string, limit = 40) {
  return db
    .query(
      `
    SELECT m.id, m.content, m.room_id, m.user_id, m.created_at, u.username
    FROM messages m JOIN users u ON m.user_id = u.id
    WHERE m.room_id = ?
    ORDER BY m.created_at DESC
    LIMIT ?
  `,
    )
    .all(roomId, limit) as Record<string, unknown>[];
}

export const chatWebSocketHandlers: {
  open: (ws: Ws) => void;
  message: (ws: Ws, message: string | Buffer) => void;
  close: (ws: Ws) => void;
} = {
  open(ws) {
    const { userId, username } = ws.data;
    ws.send(
      JSON.stringify({
        type: 'ready',
        userId,
        username,
        hint: 'Send {"type":"join","roomId":"<uuid>"} then {"type":"message","roomId":"...","content":"..."}',
      }),
    );
  },

  message(ws, message) {
    const raw = typeof message === 'string' ? message : message.toString();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      return;
    }

    const result = IncomingSchema.safeParse(parsed);
    if (!result.success) {
      ws.send(
        JSON.stringify({
          type: 'error',
          message: 'Invalid payload',
          details: result.error.flatten(),
        }),
      );
      return;
    }

    const msg = result.data;
    const { userId, username } = ws.data;

    if (msg.type === 'join') {
      const res = joinRoom(ws, msg.roomId);
      if (!res.ok) {
        ws.send(JSON.stringify({ type: 'error', message: res.error }));
        return;
      }
      const recent = fetchRecentMessages(msg.roomId).reverse();
      ws.send(
        JSON.stringify({
          type: 'joined',
          roomId: msg.roomId,
          messages: recent,
        }),
      );
      broadcastRoom(
        msg.roomId,
        {
          type: 'presence',
          event: 'join',
          roomId: msg.roomId,
          userId,
          username,
        },
        ws,
      );
      return;
    }

    if (msg.type === 'leave') {
      const current = socketRoom.get(ws);
      if (current !== msg.roomId) {
        ws.send(JSON.stringify({ type: 'error', message: 'Not in that room' }));
        return;
      }
      leaveRoom(ws);
      broadcastRoom(
        msg.roomId,
        {
          type: 'presence',
          event: 'leave',
          roomId: msg.roomId,
          userId,
          username,
        },
        ws,
      );
      ws.send(JSON.stringify({ type: 'left', roomId: msg.roomId }));
      return;
    }

    // message
    const activeRoom = socketRoom.get(ws);
    if (!activeRoom || activeRoom !== msg.roomId) {
      ws.send(
        JSON.stringify({
          type: 'error',
          message: 'Join the room first (type "join")',
        }),
      );
      return;
    }
    if (!roomExists(msg.roomId)) {
      ws.send(JSON.stringify({ type: 'error', message: 'Room no longer exists' }));
      return;
    }

    const id = crypto.randomUUID();
    db.run(
      'INSERT INTO messages (id, content, user_id, room_id) VALUES (?, ?, ?, ?)',
      [id, msg.content, userId, msg.roomId],
    );
    const row = db.query(
      `
      SELECT m.id, m.content, m.room_id, m.user_id, m.created_at, u.username
      FROM messages m JOIN users u ON m.user_id = u.id
      WHERE m.id = ?
    `,
    ).get(id) as Record<string, unknown>;

    broadcastRoom(msg.roomId, {
      type: 'message',
      ...row,
    });
  },

  close(ws) {
    const roomId = socketRoom.get(ws);
    leaveRoom(ws);
    if (roomId) {
      broadcastRoom(
        roomId,
        {
          type: 'presence',
          event: 'disconnect',
          roomId,
          userId: ws.data.userId,
          username: ws.data.username,
        },
        ws,
      );
    }
  },
};
