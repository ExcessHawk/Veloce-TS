/**
 * Raw Hono benchmark server (the underlying engine of Veloce-TS)
 * Shows the cost of Veloce-TS decorator/DI layer vs bare metal Hono.
 * Runs on port 3002
 */
import { Hono } from 'hono';
import { z } from 'zod';

const PORT = Number(process.env.BENCH_PORT ?? 3002);

const UserBodySchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  age: z.number().int().positive(),
});

const app = new Hono();

// Scenario 1: Hello World
app.get('/hello', (c) => c.json({ message: 'Hello, World!' }));

// Scenario 2: Route params
app.get('/users/:id', (c) => {
  const id = c.req.param('id');
  return c.json({ id, name: `User ${id}` });
});

// Scenario 3: JSON body echo
app.post('/echo', async (c) => {
  const body = await c.req.json();
  return c.json(body);
});

// Scenario 4: Zod validation (manual — equivalent to what Veloce-TS does internally)
app.post('/validate', async (c) => {
  const raw = await c.req.json();
  const result = UserBodySchema.safeParse(raw);
  if (!result.success) {
    return c.json({ error: 'Validation failed', details: result.error.issues }, 422);
  }
  return c.json({ ok: true, name: result.data.name }, 201);
});

Bun.serve({ fetch: app.fetch, port: PORT });
console.log(`[hono-raw] listening on :${PORT}`);
