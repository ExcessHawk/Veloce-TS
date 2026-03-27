import { Controller, Get, Post, Put, Delete, Body, Param, Ctx, Query } from 'veloce-ts';
import { NotFoundException, BadRequestException } from 'veloce-ts';
import { z } from 'zod';
import { db } from '../db';

const CreateTodoSchema = z.object({
  title:       z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  category_id: z.string().uuid().optional(),
});

const UpdateTodoSchema = z.object({
  title:       z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  completed:   z.boolean().optional(),
  category_id: z.string().uuid().nullable().optional(),
});

function rowToTodo(t: any) {
  return { ...t, completed: t.completed === 1 };
}

@Controller('/todos')
export class TodoController {
  @Get('/')
  list(@Ctx() c: any, @Query('completed') completed?: string) {
    const user = c.get('user');
    const params: any[] = [user.sub];
    let sql = `
      SELECT t.*, cat.name as category_name, cat.color as category_color
      FROM todos t LEFT JOIN categories cat ON t.category_id = cat.id
      WHERE t.user_id = ?
    `;
    if (completed !== undefined) {
      sql += ' AND t.completed = ?';
      params.push(completed === 'true' ? 1 : 0);
    }
    sql += ' ORDER BY t.created_at DESC';
    const rows = db.query(sql).all(...params).map(rowToTodo);
    return { todos: rows, total: rows.length };
  }

  @Get('/:id')
  getOne(@Param('id') id: string, @Ctx() c: any) {
    const user = c.get('user');
    const row  = db.query(`
      SELECT t.*, cat.name as category_name, cat.color as category_color
      FROM todos t LEFT JOIN categories cat ON t.category_id = cat.id
      WHERE t.id = ? AND t.user_id = ?
    `).get(id, user.sub) as any;
    if (!row) throw new NotFoundException(`Todo "${id}" not found`);
    return rowToTodo(row);
  }

  @Post('/')
  create(@Body(CreateTodoSchema) body: z.infer<typeof CreateTodoSchema>, @Ctx() c: any) {
    const user = c.get('user');
    if (body.category_id) {
      if (!db.query('SELECT id FROM categories WHERE id = ?').get(body.category_id)) {
        throw new BadRequestException(`Category "${body.category_id}" not found`);
      }
    }
    const id  = crypto.randomUUID();
    const now = new Date().toISOString();
    db.run(
      'INSERT INTO todos (id, title, description, user_id, category_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, body.title, body.description ?? null, user.sub, body.category_id ?? null, now, now],
    );
    return this.getOne(id, c);
  }

  @Put('/:id')
  update(
    @Param('id') id: string,
    @Body(UpdateTodoSchema) body: z.infer<typeof UpdateTodoSchema>,
    @Ctx() c: any,
  ) {
    const user = c.get('user');
    if (!db.query('SELECT id FROM todos WHERE id = ? AND user_id = ?').get(id, user.sub)) {
      throw new NotFoundException(`Todo "${id}" not found`);
    }
    if (body.category_id) {
      if (!db.query('SELECT id FROM categories WHERE id = ?').get(body.category_id)) {
        throw new BadRequestException(`Category "${body.category_id}" not found`);
      }
    }
    const fields: string[] = [];
    const values: any[]    = [];
    if (body.title       !== undefined) { fields.push('title = ?');       values.push(body.title); }
    if (body.description !== undefined) { fields.push('description = ?'); values.push(body.description); }
    if (body.completed   !== undefined) { fields.push('completed = ?');   values.push(body.completed ? 1 : 0); }
    if (body.category_id !== undefined) { fields.push('category_id = ?'); values.push(body.category_id); }
    if (fields.length === 0) throw new BadRequestException('No fields to update');
    fields.push('updated_at = ?');
    values.push(new Date().toISOString(), id, user.sub);
    db.run(`UPDATE todos SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`, values);
    return this.getOne(id, c);
  }

  @Delete('/:id')
  remove(@Param('id') id: string, @Ctx() c: any) {
    const user = c.get('user');
    if (!db.query('SELECT id FROM todos WHERE id = ? AND user_id = ?').get(id, user.sub)) {
      throw new NotFoundException(`Todo "${id}" not found`);
    }
    db.run('DELETE FROM todos WHERE id = ? AND user_id = ?', [id, user.sub]);
    return { success: true, message: `Todo "${id}" deleted` };
  }
}
