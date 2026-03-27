/**
 * Fastify benchmark server
 * Popular high-performance Node.js framework.
 * Runs on port 3004
 */
import Fastify from 'fastify';
import { z } from 'zod';

const PORT = Number(process.env.BENCH_PORT ?? 3004);

const UserBodySchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  age: z.number().int().positive(),
});

const fastify = Fastify({ logger: false });

// Scenario 1: Hello World
fastify.get('/hello', async () => {
  return { message: 'Hello, World!' };
});

// Scenario 2: Route params
fastify.get<{ Params: { id: string } }>('/users/:id', async (req) => {
  const { id } = req.params;
  return { id, name: `User ${id}` };
});

// Scenario 3: JSON body echo
fastify.post('/echo', async (req) => {
  return req.body;
});

// Scenario 4: Zod validation (manual — equivalent to what Veloce-TS does internally)
fastify.post('/validate', async (req, reply) => {
  const result = UserBodySchema.safeParse(req.body);
  if (!result.success) {
    reply.status(422).send({ error: 'Validation failed', details: result.error.issues });
    return;
  }
  reply.status(201).send({ ok: true, name: result.data.name });
});

await fastify.listen({ port: PORT, host: '0.0.0.0' });
console.log(`[fastify] listening on :${PORT}`);
