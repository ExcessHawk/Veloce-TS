/**
 * Express benchmark server
 * Classic Node.js framework — baseline comparison.
 * Runs on port 3003
 */
import express from 'express';
import { z } from 'zod';

const PORT = Number(process.env.BENCH_PORT ?? 3003);

const UserBodySchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  age: z.number().int().positive(),
});

const app = express();
app.use(express.json());

// Scenario 1: Hello World
app.get('/hello', (_req, res) => {
  res.json({ message: 'Hello, World!' });
});

// Scenario 2: Route params
app.get('/users/:id', (req, res) => {
  const { id } = req.params;
  res.json({ id, name: `User ${id}` });
});

// Scenario 3: JSON body echo
app.post('/echo', (req, res) => {
  res.json(req.body);
});

// Scenario 4: Zod validation
app.post('/validate', (req, res) => {
  const result = UserBodySchema.safeParse(req.body);
  if (!result.success) {
    res.status(422).json({ error: 'Validation failed', details: result.error.issues });
    return;
  }
  res.status(201).json({ ok: true, name: result.data.name });
});

app.listen(PORT, () => {
  console.log(`[express] listening on :${PORT}`);
});
