/**
 * Veloce-TS benchmark server
 * Runs on port 3001
 */
import 'reflect-metadata';
import { VeloceTS, Controller, Get, Post, Param, Body, HttpCode, Ctx } from '../../src/index';
import { z } from 'zod';

const PORT = Number(process.env.BENCH_PORT ?? 3001);

// ── Schemas ──────────────────────────────────────────────────────────────────

const UserBodySchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  age: z.number().int().positive(),
});

// ── Controllers ───────────────────────────────────────────────────────────────

@Controller()
class BenchController {
  // Scenario 1: Hello World
  @Get('/hello')
  hello() {
    return { message: 'Hello, World!' };
  }

  // Scenario 2: Route params
  @Get('/users/:id')
  getUser(@Param('id') id: string) {
    return { id, name: `User ${id}` };
  }

  // Scenario 3: JSON body echo (use Ctx to read raw body to stay fair with others)
  @Post('/echo')
  async echo(@Ctx() c: any) {
    const body = await c.req.json();
    return body;
  }

  // Scenario 4: Zod validation (Veloce-TS handles this automatically via @Body)
  @HttpCode(201)
  @Post('/validate')
  validate(@Body(UserBodySchema) body: z.infer<typeof UserBodySchema>) {
    return { ok: true, name: body.name };
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

const app = new VeloceTS({ docs: false, title: 'Bench' });
app.include(BenchController);
await app.listen(PORT);
console.log(`[veloce-ts] listening on :${PORT}`);
