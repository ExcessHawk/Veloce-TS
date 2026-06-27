import { Hono } from 'hono';
import { serve } from '@hono/node-server';

const app = new Hono();

app.get('/hello', (c) => c.json({ message: 'Hello, World!' }));

app.get('/json', (c) => {
  const obj: Record<string, unknown> = {};
  for (let i = 0; i < 100; i++) obj[`field${i}`] = i;
  return c.json(obj);
});

app.get('/params/:id', (c) => {
  const id = c.req.param('id');
  return c.json({ id, timestamp: Date.now() });
});

app.post('/validate', async (c) => {
  const body = await c.req.json();
  return c.json({ received: body });
});

console.log('Hono benchmark server on :3001');
serve({ fetch: app.fetch, port: 3001 });
