import { Hono } from 'hono';
import { z } from 'zod';

// Matches run.ts's SCENARIOS exactly, and express.ts's routes, so every
// server in the comparison answers the same requests.
const ValidateBody = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  age: z.number().int().positive(),
});

const PORT = Number(process.env.BENCH_PORT ?? 3002);

const app = new Hono();

app.get('/hello', (c) => c.json({ message: 'Hello, World!' }));

app.get('/json', (c) => {
  const obj: Record<string, unknown> = {};
  for (let i = 0; i < 100; i++) obj[`field${i}`] = i;
  return c.json(obj);
});

app.get('/users/:id', (c) => {
  const id = c.req.param('id');
  return c.json({ id, name: `User ${id}` });
});

app.post('/echo', async (c) => {
  const body = await c.req.json();
  return c.json(body);
});

app.post('/validate', async (c) => {
  const body = await c.req.json();
  const result = ValidateBody.safeParse(body);
  if (!result.success) {
    return c.json({ error: 'Validation failed', details: result.error.issues }, 422);
  }
  return c.json({ ok: true, name: result.data.name }, 201);
});

// Bun's native serve — not the @hono/node-server compat shim — so this is a
// fair comparison against veloce-ts, which also runs on Bun.serve under Bun.
console.log(`Hono benchmark server on :${PORT}`);
Bun.serve({ fetch: app.fetch, port: PORT });
