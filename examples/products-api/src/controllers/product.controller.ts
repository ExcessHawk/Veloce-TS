import { Controller, Get, Post, Put, Delete, Body, Param, Ctx, Query } from 'veloce-ts';
import { NotFoundException, BadRequestException } from 'veloce-ts';
import { z } from 'zod';
import { db } from '../db';

const CreateProductSchema = z.object({
  name:        z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  price:       z.number().positive(),
  stock:       z.number().int().min(0).default(0),
});

const UpdateProductSchema = z.object({
  name:        z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  price:       z.number().positive().optional(),
  stock:       z.number().int().min(0).optional(),
});

@Controller('/products')
export class ProductController {
  /** GET /products?search=term  (public) */
  @Get('/')
  list(@Query('search') search?: string) {
    if (search) {
      const rows = db.query(
        "SELECT * FROM products WHERE name LIKE ? OR description LIKE ? ORDER BY created_at DESC"
      ).all(`%${search}%`, `%${search}%`);
      return { products: rows, total: rows.length };
    }
    const rows = db.query('SELECT * FROM products ORDER BY created_at DESC').all();
    return { products: rows, total: rows.length };
  }

  /** GET /products/:id  (public) */
  @Get('/:id')
  getOne(@Param('id') id: string) {
    const product = db.query('SELECT * FROM products WHERE id = ?').get(id);
    if (!product) throw new NotFoundException(`Product "${id}" not found`);
    return product;
  }

  /** POST /products  (auth required) */
  @Post('/')
  create(
    @Body(CreateProductSchema) body: z.infer<typeof CreateProductSchema>,
    @Ctx() c: any,
  ) {
    const user = c.get('user');
    const id   = crypto.randomUUID();
    const now  = new Date().toISOString();

    db.run(
      'INSERT INTO products (id, name, description, price, stock, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, body.name, body.description ?? null, body.price, body.stock, user.sub, now, now],
    );

    return db.query('SELECT * FROM products WHERE id = ?').get(id);
  }

  /** PUT /products/:id  (auth required) */
  @Put('/:id')
  update(
    @Param('id') id: string,
    @Body(UpdateProductSchema) body: z.infer<typeof UpdateProductSchema>,
    @Ctx() _c: any,
  ) {
    const existing = db.query('SELECT * FROM products WHERE id = ?').get(id);
    if (!existing) throw new NotFoundException(`Product "${id}" not found`);

    if (Object.keys(body).length === 0) throw new BadRequestException('No fields provided for update');

    const fields: string[] = [];
    const values: any[]    = [];

    if (body.name        !== undefined) { fields.push('name = ?');        values.push(body.name); }
    if (body.description !== undefined) { fields.push('description = ?'); values.push(body.description); }
    if (body.price       !== undefined) { fields.push('price = ?');       values.push(body.price); }
    if (body.stock       !== undefined) { fields.push('stock = ?');       values.push(body.stock); }

    fields.push('updated_at = ?');
    values.push(new Date().toISOString(), id);

    db.run(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`, values);
    return db.query('SELECT * FROM products WHERE id = ?').get(id);
  }

  /** DELETE /products/:id  (auth required) */
  @Delete('/:id')
  remove(@Param('id') id: string, @Ctx() _c: any) {
    const existing = db.query('SELECT * FROM products WHERE id = ?').get(id);
    if (!existing) throw new NotFoundException(`Product "${id}" not found`);

    db.run('DELETE FROM products WHERE id = ?', [id]);
    return { success: true, message: `Product "${id}" deleted` };
  }
}
