import 'reflect-metadata';
import { Veloce, Controller, Get, Post, Body, Param } from '../../src/index';
import { z } from 'zod';

// Matches run.ts's SCENARIOS exactly, and express.ts's routes, so every
// server in the comparison answers the same requests.
const ValidateBody = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  age: z.number().int().positive(),
});

const PORT = Number(process.env.BENCH_PORT ?? 3001);

@Controller('/')
class BenchmarkController {
  @Get('/hello')
  hello() {
    return { message: 'Hello, World!' };
  }

  @Get('/json')
  json() {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < 100; i++) obj[`field${i}`] = i;
    return obj;
  }

  @Get('/users/:id')
  params(@Param('id') id: string) {
    return { id, name: `User ${id}` };
  }

  @Post('/echo')
  echo(@Body() body: unknown) {
    return body;
  }

  @Post('/validate')
  validate(@Body(ValidateBody) body: z.infer<typeof ValidateBody>) {
    return { ok: true, name: body.name };
  }
}

const app = new Veloce({ docs: false });
app.include(BenchmarkController);
await app.compile();
app.listen(PORT, () => console.log(`veloce-ts benchmark server on :${PORT}`));
