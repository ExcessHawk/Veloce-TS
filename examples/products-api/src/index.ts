import 'reflect-metadata';
import { Veloce, OpenAPIPlugin } from 'veloce-ts';
import { initDb } from './db';
import { requireAuth } from './middleware/auth';
import { AuthController } from './controllers/auth.controller';
import { ProductController } from './controllers/product.controller';

export async function createApp(dbPath?: string): Promise<Veloce> {
  initDb(dbPath);

  const app = new Veloce({
    title:       'Products API',
    version:     '1.0.0',
    description: 'CRUD de productos con autenticación JWT. Template: REST',
    docs: true,
    cors: { origin: '*', credentials: true },
  });

  // Swagger + OpenAPI spec — auto-serves /openapi.json and /docs
  app.usePlugin(new OpenAPIPlugin({
    path:     '/openapi.json',
    docsPath: '/docs',
    docs:     true,
  }));

  // Register controllers
  app.include(AuthController);
  app.include(ProductController);

  // Protect only write operations (POST/PUT/DELETE) — GET stays public
  app.getHono().on(['POST', 'PUT', 'DELETE'], '/products/*', requireAuth);

  await app.compile();
  return app;
}

// Only start the server when this file is the entry point (not when imported in tests)
if (import.meta.main) {
  const app = await createApp();

  app.listen(3000, () => {
    console.log('');
    console.log('  Products API  ─  REST template');
    console.log('  ─────────────────────────────────────────');
    console.log('  Server:  http://localhost:3000');
    console.log('  Swagger: http://localhost:3000/docs');
    console.log('  Spec:    http://localhost:3000/openapi.json');
    console.log('');
    console.log('  POST   /auth/register         crear cuenta');
    console.log('  POST   /auth/login            obtener token JWT');
    console.log('  GET    /products              listar (público)');
    console.log('  GET    /products/:id          detalle (público)');
    console.log('  POST   /products              crear  (auth)');
    console.log('  PUT    /products/:id          editar (auth)');
    console.log('  DELETE /products/:id          borrar (auth)');
    console.log('');
  });
}
