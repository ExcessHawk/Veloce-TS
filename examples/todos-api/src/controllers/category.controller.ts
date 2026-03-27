import { Controller, Get, Post, Put, Delete, Body, Param, Ctx } from 'veloce-ts';
import { NotFoundException, BadRequestException } from 'veloce-ts';
import { z } from 'zod';
import { db } from '../db';

const CreateCategorySchema = z.object({
  name:  z.string().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

const UpdateCategorySchema = z.object({
  name:  z.string().min(1).max(60).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

@Controller('/categories')
export class CategoryController {
  @Get('/')
  list() {
    const rows = db.query('SELECT * FROM categories ORDER BY name ASC').all();
    return { categories: rows, total: rows.length };
  }

  @Get('/:id')
  getOne(@Param('id') id: string) {
    const cat = db.query('SELECT * FROM categories WHERE id = ?').get(id);
    if (!cat) throw new NotFoundException(`Category "${id}" not found`);
    return cat;
  }

  @Post('/')
  create(@Body(CreateCategorySchema) body: z.infer<typeof CreateCategorySchema>, @Ctx() c: any) {
    const user = c.get('user');
    if (db.query('SELECT id FROM categories WHERE name = ?').get(body.name)) {
      throw new BadRequestException(`Category name "${body.name}" already exists`);
    }
    const id = crypto.randomUUID();
    db.run(
      'INSERT INTO categories (id, name, color, user_id) VALUES (?, ?, ?, ?)',
      [id, body.name, body.color ?? '#6366f1', user.sub],
    );
    return db.query('SELECT * FROM categories WHERE id = ?').get(id);
  }

  @Put('/:id')
  update(
    @Param('id') id: string,
    @Body(UpdateCategorySchema) body: z.infer<typeof UpdateCategorySchema>,
    @Ctx() _c: any,
  ) {
    if (!db.query('SELECT id FROM categories WHERE id = ?').get(id)) {
      throw new NotFoundException(`Category "${id}" not found`);
    }
    const fields: string[] = [];
    const values: any[]    = [];
    if (body.name  !== undefined) { fields.push('name = ?');  values.push(body.name); }
    if (body.color !== undefined) { fields.push('color = ?'); values.push(body.color); }
    if (fields.length === 0) throw new BadRequestException('No fields to update');
    values.push(id);
    db.run(`UPDATE categories SET ${fields.join(', ')} WHERE id = ?`, values);
    return db.query('SELECT * FROM categories WHERE id = ?').get(id);
  }

  @Delete('/:id')
  remove(@Param('id') id: string, @Ctx() _c: any) {
    if (!db.query('SELECT id FROM categories WHERE id = ?').get(id)) {
      throw new NotFoundException(`Category "${id}" not found`);
    }
    db.run('DELETE FROM categories WHERE id = ?', [id]);
    return { success: true, message: `Category "${id}" deleted` };
  }
}
