import 'reflect-metadata';
import { Veloce, OpenAPIPlugin } from 'veloce-ts';
import { initDb } from './db';
import { requireAuth, jwtProvider } from './middleware/auth';
import { AuthController } from './controllers/auth.controller';
import { RoomController } from './controllers/room.controller';

export async function createApp(dbPath?: string): Promise<Veloce> {
  initDb(dbPath);

  const app = new Veloce({
    title:       'Chat WebSocket API',
    version:     '1.0.0',
    description: 'Rooms + Messages CRUD con auth JWT y endpoint WebSocket. Template: WebSocket',
    docs: true,
    cors: { origin: '*', credentials: true },
  });

  app.usePlugin(new OpenAPIPlugin({
    path:     '/openapi.json',
    docsPath: '/docs',
    docs:     true,
  }));

  app.include(AuthController);
  app.include(RoomController);

  // All room and message operations require authentication
  app.getHono().use('/rooms/*', requireAuth);

  // WebSocket endpoint — GET /ws/chat?token=<JWT>
  // In a real Bun.serve() environment this upgrades to WebSocket.
  // For HTTP requests (tests) it returns 426 Upgrade Required.
  app.getHono().get('/ws/chat', async (c: any) => {
    const upgradeHeader = c.req.header('upgrade');

    if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
      return c.json(
        { error: 'WebSocket upgrade required', hint: 'Connect via ws://host/ws/chat?token=<JWT>' },
        426,
      );
    }

    const token = c.req.query('token');
    if (!token) {
      return c.json({ error: 'token query param required for WebSocket auth' }, 401);
    }

    try {
      jwtProvider.verifyAccessToken(token);
    } catch {
      return c.json({ error: 'Invalid or expired token' }, 401);
    }

    // Bun server upgrade
    const env = (c as any).env as any;
    if (env?.upgrade) {
      env.upgrade(c.req.raw);
      return undefined as any;
    }

    return c.json({ error: 'WebSocket not supported in this environment' }, 501);
  });

  await app.compile();
  return app;
}

if (import.meta.main) {
  const app = await createApp();

  app.listen(3002, () => {
    console.log('');
    console.log('  Chat WebSocket API  ─  WebSocket template');
    console.log('  ──────────────────────────────────────────────────');
    console.log('  Server:    http://localhost:3002');
    console.log('  Swagger:   http://localhost:3002/docs');
    console.log('  Spec:      http://localhost:3002/openapi.json');
    console.log('  WebSocket: ws://localhost:3002/ws/chat?token=<JWT>');
    console.log('');
    console.log('  POST   /auth/register');
    console.log('  POST   /auth/login');
    console.log('  GET    /rooms                     (auth)');
    console.log('  POST   /rooms                     (auth)');
    console.log('  GET    /rooms/:id                 (auth)');
    console.log('  DELETE /rooms/:id                 (auth, dueño)');
    console.log('  GET    /rooms/:id/messages        (auth)');
    console.log('  POST   /rooms/:id/messages        (auth)');
    console.log('  DELETE /rooms/:id/messages/:msgId (auth, autor)');
    console.log('  GET    /ws/chat?token=<JWT>       (WebSocket upgrade)');
    console.log('');
  });
}
