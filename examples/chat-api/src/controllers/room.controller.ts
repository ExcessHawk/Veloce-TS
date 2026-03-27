import { Controller, Get, Post, Delete, Body, Param, Ctx } from 'veloce-ts';
import { NotFoundException, BadRequestException } from 'veloce-ts';
import { z } from 'zod';
import { db } from '../db';

const CreateRoomSchema = z.object({
  name:        z.string().min(1).max(60),
  description: z.string().max(200).optional(),
});

const SendMessageSchema = z.object({
  content: z.string().min(1).max(2000),
});

function roomRow(r: any) {
  return { ...r };
}

@Controller('/rooms')
export class RoomController {
  /** GET /rooms  (auth required) */
  @Get('/')
  list(@Ctx() _c: any) {
    const rows = db.query(`
      SELECT r.*, u.username as owner_username,
        (SELECT COUNT(*) FROM messages m WHERE m.room_id = r.id) as message_count
      FROM rooms r LEFT JOIN users u ON r.owner_id = u.id
      ORDER BY r.created_at DESC
    `).all();
    return { rooms: rows, total: rows.length };
  }

  /** GET /rooms/:id  (auth required) */
  @Get('/:id')
  getOne(@Param('id') id: string, @Ctx() _c: any) {
    const row = db.query(`
      SELECT r.*, u.username as owner_username,
        (SELECT COUNT(*) FROM messages m WHERE m.room_id = r.id) as message_count
      FROM rooms r LEFT JOIN users u ON r.owner_id = u.id
      WHERE r.id = ?
    `).get(id);
    if (!row) throw new NotFoundException(`Room "${id}" not found`);
    return row;
  }

  /** POST /rooms  (auth required) */
  @Post('/')
  create(@Body(CreateRoomSchema) body: z.infer<typeof CreateRoomSchema>, @Ctx() c: any) {
    const user = c.get('user');
    if (db.query('SELECT id FROM rooms WHERE name = ?').get(body.name)) {
      throw new BadRequestException(`Room "${body.name}" already exists`);
    }
    const id = crypto.randomUUID();
    db.run(
      'INSERT INTO rooms (id, name, description, owner_id) VALUES (?, ?, ?, ?)',
      [id, body.name, body.description ?? null, user.sub],
    );
    return this.getOne(id, c);
  }

  /** DELETE /rooms/:id  (auth required – owner only) */
  @Delete('/:id')
  remove(@Param('id') id: string, @Ctx() c: any) {
    const user = c.get('user');
    const room = db.query('SELECT * FROM rooms WHERE id = ?').get(id) as any;
    if (!room) throw new NotFoundException(`Room "${id}" not found`);
    if (room.owner_id !== user.sub) {
      throw new BadRequestException('Only the room owner can delete it');
    }
    db.run('DELETE FROM rooms WHERE id = ?', [id]);
    return { success: true, message: `Room "${id}" deleted` };
  }

  // ─── Messages nested under /rooms/:roomId/messages ────────────────────────

  /** GET /rooms/:roomId/messages  (auth required) */
  @Get('/:roomId/messages')
  listMessages(@Param('roomId') roomId: string, @Ctx() _c: any) {
    if (!db.query('SELECT id FROM rooms WHERE id = ?').get(roomId)) {
      throw new NotFoundException(`Room "${roomId}" not found`);
    }
    const rows = db.query(`
      SELECT m.*, u.username
      FROM messages m JOIN users u ON m.user_id = u.id
      WHERE m.room_id = ?
      ORDER BY m.created_at ASC
    `).all(roomId);
    return { messages: rows, total: rows.length };
  }

  /** POST /rooms/:roomId/messages  (auth required) */
  @Post('/:roomId/messages')
  sendMessage(
    @Param('roomId') roomId: string,
    @Body(SendMessageSchema) body: z.infer<typeof SendMessageSchema>,
    @Ctx() c: any,
  ) {
    const user = c.get('user');
    if (!db.query('SELECT id FROM rooms WHERE id = ?').get(roomId)) {
      throw new NotFoundException(`Room "${roomId}" not found`);
    }
    const id = crypto.randomUUID();
    db.run(
      'INSERT INTO messages (id, content, user_id, room_id) VALUES (?, ?, ?, ?)',
      [id, body.content, user.sub, roomId],
    );
    return db.query(`
      SELECT m.*, u.username
      FROM messages m JOIN users u ON m.user_id = u.id
      WHERE m.id = ?
    `).get(id);
  }

  /** DELETE /rooms/:roomId/messages/:messageId  (auth required – author only) */
  @Delete('/:roomId/messages/:messageId')
  deleteMessage(
    @Param('roomId') roomId: string,
    @Param('messageId') messageId: string,
    @Ctx() c: any,
  ) {
    const user = c.get('user');
    const msg  = db.query(
      'SELECT * FROM messages WHERE id = ? AND room_id = ?'
    ).get(messageId, roomId) as any;

    if (!msg) throw new NotFoundException(`Message "${messageId}" not found`);
    if (msg.user_id !== user.sub) {
      throw new BadRequestException('Only the message author can delete it');
    }
    db.run('DELETE FROM messages WHERE id = ?', [messageId]);
    return { success: true, message: `Message "${messageId}" deleted` };
  }
}
