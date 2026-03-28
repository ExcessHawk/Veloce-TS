/**
 * Chat WebSocket API – test suite
 * Template: websocket  |  DB: SQLite in-memory
 *
 * Endpoints covered:
 *   POST /auth/register | POST /auth/login
 *   GET|POST|DELETE /rooms
 *   GET|POST|DELETE /rooms/:id/messages
 *   GET /ws/chat  (426 without upgrade header)
 *   GET /openapi.json | GET /docs
 */
import { describe, it, expect, beforeAll } from 'bun:test';
import { createApp } from '../src/index';

// ─── helpers ──────────────────────────────────────────────────────────────────

let hono: any;
let token: string;    // charlie's token
let token2: string;   // diana's token
let roomId: string;
let messageId: string;

async function req(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return hono.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  );
}

const bearer  = () => ({ Authorization: `Bearer ${token}` });
const bearer2 = () => ({ Authorization: `Bearer ${token2}` });

beforeAll(async () => {
  const app = await createApp(':memory:');
  hono = (app as any).getHono();
});

// ─── auth ─────────────────────────────────────────────────────────────────────

describe('POST /auth/register', () => {
  it('registra a charlie', async () => {
    const res  = await req('POST', '/auth/register', {
      username: 'charlie',
      email:    'charlie@example.com',
      password: 'charliepass',
    });
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    token = body.tokens.accessToken;
  });

  it('registra a diana', async () => {
    const res  = await req('POST', '/auth/register', {
      username: 'diana',
      email:    'diana@example.com',
      password: 'dianapass123',
    });
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    token2 = body.tokens.accessToken;
  });

  it('rechaza username duplicado', async () => {
    const res = await req('POST', '/auth/register', {
      username: 'charlie',
      email:    'charlie2@example.com',
      password: 'charliepass',
    });
    expect(res.status).toBe(400);
  });

  it('valida mínimo de password', async () => {
    const res = await req('POST', '/auth/register', {
      username: 'newuser', email: 'n@x.com', password: '123',
    });
    expect(res.status).toBe(422);
  });
});

describe('POST /auth/login', () => {
  it('devuelve tokens con credenciales válidas', async () => {
    const res  = await req('POST', '/auth/login', {
      username: 'charlie',
      password: 'charliepass',
    });
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.tokens.accessToken).toBeTruthy();
    token = body.tokens.accessToken;
  });

  it('rechaza contraseña incorrecta', async () => {
    const res = await req('POST', '/auth/login', { username: 'charlie', password: 'bad' });
    expect(res.status).toBe(401);
  });

  it('rechaza usuario inexistente', async () => {
    const res = await req('POST', '/auth/login', { username: 'nobody', password: 'pass' });
    expect(res.status).toBe(401);
  });
});

// ─── rooms ────────────────────────────────────────────────────────────────────

describe('GET /rooms (vacío)', () => {
  it('devuelve 401 sin token', async () => {
    const res = await req('GET', '/rooms');
    expect(res.status).toBe(401);
  });

  it('devuelve lista vacía', async () => {
    const res  = await req('GET', '/rooms', undefined, bearer());
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.rooms).toHaveLength(0);
  });
});

describe('POST /rooms', () => {
  it('devuelve 401 sin token', async () => {
    const res = await req('POST', '/rooms', { name: 'general' });
    expect(res.status).toBe(401);
  });

  it('crea un room', async () => {
    const res  = await req('POST', '/rooms', {
      name:        'general',
      description: 'Canal general',
    }, bearer());
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.name).toBe('general');
    expect(body.owner_username).toBe('charlie');
    expect(body.id).toBeTruthy();

    roomId = body.id;
  });

  it('rechaza nombre de room duplicado', async () => {
    const res = await req('POST', '/rooms', { name: 'general' }, bearer());
    expect(res.status).toBe(400);
  });

  it('valida name no vacío', async () => {
    const res = await req('POST', '/rooms', { name: '' }, bearer());
    expect(res.status).toBe(422);
  });
});

describe('GET /rooms/:id', () => {
  it('devuelve el room', async () => {
    const res  = await req('GET', `/rooms/${roomId}`, undefined, bearer());
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.id).toBe(roomId);
    expect(body.name).toBe('general');
  });

  it('devuelve 404 para id inexistente', async () => {
    const res = await req('GET', '/rooms/no-existe', undefined, bearer());
    expect(res.status).toBe(404);
  });
});

// ─── messages ─────────────────────────────────────────────────────────────────

describe('GET /rooms/:id/messages (vacío)', () => {
  it('devuelve lista vacía de mensajes', async () => {
    const res  = await req('GET', `/rooms/${roomId}/messages`, undefined, bearer());
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.messages).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  it('devuelve 404 para room inexistente', async () => {
    const res = await req('GET', '/rooms/bad-id/messages', undefined, bearer());
    expect(res.status).toBe(404);
  });
});

describe('POST /rooms/:id/messages', () => {
  it('devuelve 401 sin token', async () => {
    const res = await req('POST', `/rooms/${roomId}/messages`, { content: 'Hola' });
    expect(res.status).toBe(401);
  });

  it('charlie envía un mensaje', async () => {
    const res  = await req('POST', `/rooms/${roomId}/messages`, {
      content: '¡Hola a todos!',
    }, bearer());
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.content).toBe('¡Hola a todos!');
    expect(body.username).toBe('charlie');
    expect(body.id).toBeTruthy();

    messageId = body.id;
  });

  it('diana envía un mensaje', async () => {
    const res  = await req('POST', `/rooms/${roomId}/messages`, {
      content: '¡Hola charlie!',
    }, bearer2());
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.username).toBe('diana');
  });

  it('valida content no vacío', async () => {
    const res = await req('POST', `/rooms/${roomId}/messages`, { content: '' }, bearer());
    expect(res.status).toBe(422);
  });

  it('devuelve 404 para room inexistente', async () => {
    const res = await req('POST', '/rooms/bad-id/messages', { content: 'hi' }, bearer());
    expect(res.status).toBe(404);
  });
});

describe('GET /rooms/:id/messages (con mensajes)', () => {
  it('devuelve los 2 mensajes en orden cronológico', async () => {
    const res  = await req('GET', `/rooms/${roomId}/messages`, undefined, bearer());
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.messages[0].content).toBe('¡Hola a todos!');
    expect(body.messages[1].content).toBe('¡Hola charlie!');
  });
});

describe('GET /rooms (con message_count)', () => {
  it('muestra message_count = 2', async () => {
    const res  = await req('GET', '/rooms', undefined, bearer());
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.rooms[0].message_count).toBe(2);
  });
});

describe('DELETE /rooms/:id/messages/:messageId', () => {
  it('devuelve 401 sin token', async () => {
    const res = await req('DELETE', `/rooms/${roomId}/messages/${messageId}`);
    expect(res.status).toBe(401);
  });

  it('diana no puede borrar el mensaje de charlie', async () => {
    const res = await req('DELETE', `/rooms/${roomId}/messages/${messageId}`, undefined, bearer2());
    expect(res.status).toBe(400);
  });

  it('charlie borra su propio mensaje', async () => {
    const res  = await req('DELETE', `/rooms/${roomId}/messages/${messageId}`, undefined, bearer());
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('devuelve 404 al intentar borrar de nuevo', async () => {
    const res = await req('DELETE', `/rooms/${roomId}/messages/${messageId}`, undefined, bearer());
    expect(res.status).toBe(404);
  });
});

describe('DELETE /rooms/:id', () => {
  it('devuelve 401 sin token', async () => {
    const res = await req('DELETE', `/rooms/${roomId}`);
    expect(res.status).toBe(401);
  });

  it('diana no puede borrar el room de charlie', async () => {
    const res = await req('DELETE', `/rooms/${roomId}`, undefined, bearer2());
    expect(res.status).toBe(400);
  });

  it('charlie borra su propio room', async () => {
    const res  = await req('DELETE', `/rooms/${roomId}`, undefined, bearer());
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('devuelve 404 al intentar borrar de nuevo', async () => {
    const res = await req('DELETE', `/rooms/${roomId}`, undefined, bearer());
    expect(res.status).toBe(404);
  });
});

// ─── WebSocket endpoint ───────────────────────────────────────────────────────

describe('GET /ws/chat', () => {
  it('devuelve 426 sin WebSocket upgrade header', async () => {
    const res  = await req('GET', '/ws/chat');
    const body = await res.json() as any;

    expect(res.status).toBe(426);
    expect(body.error).toContain('upgrade');
    expect(body.hint).toContain('ws://');
  });

  it('devuelve 401 si el token de query está ausente (con upgrade header)', async () => {
    const res = await hono.fetch(
      new Request('http://localhost/ws/chat', {
        headers: { upgrade: 'websocket', connection: 'Upgrade' },
      }),
    );
    const body = await res.json() as any;

    expect(res.status).toBe(401);
    expect(body.error).toContain('token');
  });

  it('devuelve 401 con token inválido (con upgrade header)', async () => {
    const res = await hono.fetch(
      new Request('http://localhost/ws/chat?token=not.a.valid.jwt', {
        headers: { upgrade: 'websocket', connection: 'Upgrade' },
      }),
    );
    const body = await res.json() as any;

    expect(res.status).toBe(401);
    expect(body.error).toMatch(/invalid|expired|Invalid/i);
  });
});

// ─── OpenAPI / Swagger ────────────────────────────────────────────────────────

describe('OpenAPI / Swagger', () => {
  it('GET /openapi.json devuelve spec correcta', async () => {
    const res  = await req('GET', '/openapi.json');
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.openapi).toBe('3.0.0');
    expect(body.info.title).toBe('Chat WebSocket API');
    expect(body.paths).toBeDefined();
  });

  it('GET /docs devuelve Swagger UI HTML', async () => {
    const res  = await req('GET', '/docs');
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('swagger');
  });
});
