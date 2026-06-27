import 'reflect-metadata';
import { Veloce, Controller, Get, Post, Body, Param } from '../../src/index';
import { z } from 'zod';

const BenchmarkBody = z.object({ name: z.string(), value: z.number() });

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

  @Get('/params/:id')
  params(@Param('id') id: string) {
    return { id, timestamp: Date.now() };
  }

  @Post('/validate')
  validate(@Body(BenchmarkBody) body: z.infer<typeof BenchmarkBody>) {
    return { received: body };
  }
}

const app = new Veloce({ docs: false });
app.include(BenchmarkController);
await app.compile();
app.listen(3000, () => console.log('veloce-ts benchmark server on :3000'));
