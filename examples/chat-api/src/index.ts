import 'reflect-metadata';
import os from 'node:os';
import { Veloce, OpenAPIPlugin } from 'veloce-ts';
import { initDb, db } from './db';
import { requireAuth, jwtProvider } from './middleware/auth';
import { AuthController } from './controllers/auth.controller';
import { RoomController } from './controllers/room.controller';
import { chatWebSocketHandlers, type ChatWsData } from './ws/chat-handlers';

export async function createApp(dbPath?: string): Promise<Veloce> {
  initDb(dbPath);

  const app = new Veloce({
    title:       'Chat WebSocket API',
    version:     '1.0.0',
    description: 'Salas y mensajes (REST + WebSocket en tiempo real con JWT).',
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

  app.getHono().use('/rooms/*', requireAuth);

  // Sin Bun.serve no hay upgrade: los tests usan fetch() HTTP y reciben 426 / 401 / 501.
  app.getHono().get('/ws/chat', async (c: any) => {
    const upgradeHeader = c.req.header('upgrade');

    if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
      return c.json(
        {
          error: 'WebSocket upgrade required',
          hint:  'Connect via ws://host/ws/chat?token=<JWT>',
        },
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

    return c.json(
      {
        error: 'WebSocket upgrade runs when you start with `bun run dev` (Bun.serve).',
        hint:  'Plain HTTP fetch cannot upgrade; use a WebSocket client against ws://…',
      },
      501,
    );
  });

  await app.compile();
  return app;
}

function ipv4LanAddresses(): string[] {
  const out: string[] = [];
  const nets = os.networkInterfaces();
  for (const list of Object.values(nets)) {
    if (!list) continue;
    for (const net of list) {
      // En runtime `family` puede ser 'IPv4' o 4 según versión de Node/Bun
      const fam = net.family as string | number;
      const v4  = fam === 'IPv4' || fam === 4;
      if (v4 && !net.internal) {
        out.push(net.address);
      }
    }
  }
  return out;
}

if (import.meta.main) {
  const app  = await createApp();
  const hono = app.getHono();
  const port     = Number(process.env.PORT) || 3002;
  /** 0.0.0.0 = acepta conexiones desde otros dispositivos en la misma red (móvil, otra PC) */
  const hostname = process.env.HOST || '0.0.0.0';

  Bun.serve<ChatWsData>({
    hostname,
    port,
    fetch(req, server) {
      const url = new URL(req.url);

      if (url.pathname === '/ws/chat') {
        const upgrade = req.headers.get('upgrade');
        if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
          return hono.fetch(req);
        }

        const token = url.searchParams.get('token');
        if (!token) {
          return Response.json(
            { error: 'token query param required for WebSocket auth' },
            { status: 401 },
          );
        }

        try {
          const payload = jwtProvider.verifyAccessToken(token) as {
            sub: string;
            username?: string;
          };
          let username = typeof payload.username === 'string' ? payload.username : '';
          if (!username) {
            const row = db.query('SELECT username FROM users WHERE id = ?').get(payload.sub) as
              | { username: string }
              | undefined;
            username = row?.username ?? 'user';
          }

          const upgraded = server.upgrade(req, {
            data: { userId: payload.sub, username },
          });
          if (upgraded) {
            return undefined as unknown as Response;
          }
        } catch {
          return Response.json({ error: 'Invalid or expired token' }, { status: 401 });
        }

        return new Response('WebSocket upgrade failed', { status: 500 });
      }

      return hono.fetch(req);
    },
    websocket: chatWebSocketHandlers,
  });

  const lan = ipv4LanAddresses();

  console.log('');
  console.log('  Chat API  —  REST + WebSocket (Bun)');
  console.log('  ──────────────────────────────────────────────────');
  console.log(`  Escuchando en ${hostname}:${port} (LAN: usa la IP de tu PC en el móvil)`);
  console.log(`  HTTP:      http://localhost:${port}`);
  if (lan.length) {
    for (const ip of lan) {
      console.log(`  HTTP (LAN): http://${ip}:${port}`);
      console.log(`  WS   (LAN): ws://${ip}:${port}/ws/chat?token=<JWT>`);
    }
  }
  console.log(`  Swagger:   http://localhost:${port}/docs`);
  console.log(`  WebSocket: ws://localhost:${port}/ws/chat?token=<JWT>`);
  console.log('');
  console.log('  WS protocol (después de conectar):');
  console.log('    1) {"type":"join","roomId":"<uuid>"}  → historial + sala');
  console.log('    2) {"type":"message","roomId":"<uuid>","content":"hola"}');
  console.log('    3) {"type":"leave","roomId":"<uuid>"}  (opcional)');
  console.log('');
}
