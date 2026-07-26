// Run with: bun benchmarks/servers/fastify.ts
// Note: requires fastify installed: bun add fastify

import Fastify from 'fastify';
import { z } from 'zod';

// Matches run.ts's SCENARIOS exactly, and express.ts's routes, so every
// server in the comparison answers the same requests.
const ValidateBody = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  age: z.number().int().positive(),
});

const PORT = Number(process.env.BENCH_PORT ?? 3004);

const fastify = Fastify();

fastify.get('/hello', async () => ({ message: 'Hello, World!' }));

fastify.get('/json', async () => {
  const obj: Record<string, unknown> = {};
  for (let i = 0; i < 100; i++) obj[`field${i}`] = i;
  return obj;
});

fastify.get<{ Params: { id: string } }>('/users/:id', async (req) => ({
  id: req.params.id,
  name: `User ${req.params.id}`,
}));

fastify.post('/echo', async (req) => req.body);

fastify.post('/validate', async (req, reply) => {
  const result = ValidateBody.safeParse(req.body);
  if (!result.success) {
    reply.code(422);
    return { error: 'Validation failed', details: result.error.issues };
  }
  reply.code(201);
  return { ok: true, name: result.data.name };
});

await fastify.listen({ port: PORT });
console.log(`Fastify benchmark server on :${PORT}`);
