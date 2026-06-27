// Run with: bun benchmarks/servers/fastify.ts
// Note: requires fastify installed: bun add fastify

import Fastify from 'fastify';

const fastify = Fastify();

fastify.get('/hello', async () => ({ message: 'Hello, World!' }));

fastify.get('/json', async () => {
  const obj: Record<string, unknown> = {};
  for (let i = 0; i < 100; i++) obj[`field${i}`] = i;
  return obj;
});

fastify.get<{ Params: { id: string } }>('/params/:id', async (req) => ({
  id: req.params.id,
  timestamp: Date.now(),
}));

fastify.post('/validate', async (req) => ({ received: req.body }));

await fastify.listen({ port: 3002 });
console.log('Fastify benchmark server on :3002');
