import 'reflect-metadata';
import { Veloce, OpenAPIPlugin } from 'veloce-ts';
import { initDb } from './db';
import { requireAuth } from './middleware/auth';
import { AuthController } from './controllers/auth.controller';
import { CategoryController } from './controllers/category.controller';
import { TodoController } from './controllers/todo.controller';

export async function createApp(dbPath?: string): Promise<Veloce> {
  initDb(dbPath);

  const app = new Veloce({
    title:       'Todos Fullstack API',
    version:     '1.0.0',
    description: 'CRUD de todos y categorías con autenticación JWT. Template: Fullstack',
    docs: true,
    cors: { origin: '*', credentials: true },
  });

  app.usePlugin(new OpenAPIPlugin({
    path:     '/openapi.json',
    docsPath: '/docs',
    docs:     true,
  }));

  app.include(AuthController);
  app.include(CategoryController);
  app.include(TodoController);

  // Categories: GET is public, writes require auth
  app.getHono().on(['POST', 'PUT', 'DELETE'], '/categories/*', requireAuth);
  // All todo operations require auth
  app.getHono().use('/todos/*', requireAuth);

  await app.compile();
  return app;
}

if (import.meta.main) {
  const app = await createApp();

  app.listen(3001, () => {
    console.log('');
    console.log('  Todos Fullstack API  ─  Fullstack template');
    console.log('  ─────────────────────────────────────────────────');
    console.log('  Server:  http://localhost:3001');
    console.log('  Swagger: http://localhost:3001/docs');
    console.log('  Spec:    http://localhost:3001/openapi.json');
    console.log('');
    console.log('  POST   /auth/register');
    console.log('  POST   /auth/login');
    console.log('  GET    /categories                (público)');
    console.log('  GET    /categories/:id            (público)');
    console.log('  POST   /categories                (auth)');
    console.log('  PUT    /categories/:id            (auth)');
    console.log('  DELETE /categories/:id            (auth)');
    console.log('  GET    /todos                     (auth)');
    console.log('  GET    /todos?completed=true|false (auth)');
    console.log('  GET    /todos/:id                 (auth)');
    console.log('  POST   /todos                     (auth)');
    console.log('  PUT    /todos/:id                 (auth)');
    console.log('  DELETE /todos/:id                 (auth)');
    console.log('');
  });
}
