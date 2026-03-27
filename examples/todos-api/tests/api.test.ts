/**
 * Todos Fullstack API – test suite
 * Template: fullstack  |  DB: SQLite in-memory
 *
 * Endpoints covered:
 *   POST /auth/register | POST /auth/login
 *   GET|POST|PUT|DELETE /categories
 *   GET|POST|PUT|DELETE /todos  (includes ?completed filter)
 *   GET /openapi.json | GET /docs
 */
import { describe, it, expect, beforeAll } from 'bun:test';
import { createApp } from '../src/index';

// ─── helpers ──────────────────────────────────────────────────────────────────

let hono: any;
let token: string;
let categoryId: string;
let todoId: string;

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

const bearer = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  const app = await createApp(':memory:');
  hono = (app as any).getHono();
});

// ─── auth ─────────────────────────────────────────────────────────────────────

describe('POST /auth/register', () => {
  it('crea una cuenta nueva', async () => {
    const res  = await req('POST', '/auth/register', {
      username: 'bob',
      email:    'bob@example.com',
      password: 'bobpass123',
    });
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.tokens.accessToken).toBeTruthy();
    token = body.tokens.accessToken;
  });

  it('rechaza username duplicado', async () => {
    const res = await req('POST', '/auth/register', {
      username: 'bob',
      email:    'bob2@example.com',
      password: 'bobpass123',
    });
    expect(res.status).toBe(400);
  });

  it('valida mínimo de username', async () => {
    const res = await req('POST', '/auth/register', {
      username: 'ab', email: 'x@x.com', password: 'pass123',
    });
    expect(res.status).toBe(422);
  });
});

describe('POST /auth/login', () => {
  it('devuelve tokens con credenciales válidas', async () => {
    const res  = await req('POST', '/auth/login', {
      username: 'bob',
      password: 'bobpass123',
    });
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.tokens.accessToken).toBeTruthy();
    token = body.tokens.accessToken;
  });

  it('rechaza contraseña incorrecta', async () => {
    const res = await req('POST', '/auth/login', { username: 'bob', password: 'bad' });
    expect(res.status).toBe(401);
  });
});

// ─── categories ───────────────────────────────────────────────────────────────

describe('GET /categories', () => {
  it('lista vacía sin autenticación (público)', async () => {
    const res  = await req('GET', '/categories');
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(Array.isArray(body.categories)).toBe(true);
    expect(body.total).toBe(0);
  });
});

describe('POST /categories', () => {
  it('devuelve 401 sin token', async () => {
    const res = await req('POST', '/categories', { name: 'Work' });
    expect(res.status).toBe(401);
  });

  it('crea una categoría', async () => {
    const res  = await req('POST', '/categories', {
      name:  'Work',
      color: '#ef4444',
    }, bearer());
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.name).toBe('Work');
    expect(body.color).toBe('#ef4444');
    expect(body.id).toBeTruthy();

    categoryId = body.id;
  });

  it('rechaza nombre de categoría duplicado', async () => {
    const res = await req('POST', '/categories', { name: 'Work' }, bearer());
    expect(res.status).toBe(400);
  });

  it('valida formato de color hex', async () => {
    const res = await req('POST', '/categories', { name: 'Design', color: 'red' }, bearer());
    expect(res.status).toBe(422);
  });
});

describe('GET /categories/:id', () => {
  it('devuelve la categoría (público)', async () => {
    const res  = await req('GET', `/categories/${categoryId}`);
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.id).toBe(categoryId);
    expect(body.name).toBe('Work');
  });

  it('devuelve 404 para id inexistente', async () => {
    const res = await req('GET', '/categories/no-existe');
    expect(res.status).toBe(404);
  });
});

describe('PUT /categories/:id', () => {
  it('devuelve 401 sin token', async () => {
    const res = await req('PUT', `/categories/${categoryId}`, { name: 'Personal' });
    expect(res.status).toBe(401);
  });

  it('actualiza el nombre', async () => {
    const res  = await req('PUT', `/categories/${categoryId}`, { name: 'Personal' }, bearer());
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.name).toBe('Personal');
  });

  it('devuelve 400 si body está vacío', async () => {
    const res = await req('PUT', `/categories/${categoryId}`, {}, bearer());
    expect(res.status).toBe(400);
  });
});

// ─── todos ─────────────────────────────────────────────────────────────────────

describe('GET /todos (vacío)', () => {
  it('devuelve 401 sin token', async () => {
    const res = await req('GET', '/todos');
    expect(res.status).toBe(401);
  });

  it('lista vacía al inicio', async () => {
    const res  = await req('GET', '/todos', undefined, bearer());
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.todos).toHaveLength(0);
    expect(body.total).toBe(0);
  });
});

describe('POST /todos', () => {
  it('devuelve 401 sin token', async () => {
    const res = await req('POST', '/todos', { title: 'Algo' });
    expect(res.status).toBe(401);
  });

  it('crea un todo sin categoría', async () => {
    const res  = await req('POST', '/todos', {
      title:       'Comprar leche',
      description: 'Del supermercado',
    }, bearer());
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.title).toBe('Comprar leche');
    expect(body.completed).toBe(false);
    expect(body.id).toBeTruthy();

    todoId = body.id;
  });

  it('crea un todo con categoría válida', async () => {
    const res  = await req('POST', '/todos', {
      title:       'Reunión de equipo',
      category_id: categoryId,
    }, bearer());
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.category_id).toBe(categoryId);
    expect(body.category_name).toBe('Personal');
  });

  it('rechaza category_id con formato no-UUID', async () => {
    const res = await req('POST', '/todos', {
      title:       'Bad',
      category_id: 'not-a-uuid',
    }, bearer());
    expect(res.status).toBe(422);
  });

  it('valida title obligatorio', async () => {
    const res = await req('POST', '/todos', { description: 'sin título' }, bearer());
    expect(res.status).toBe(422);
  });
});

describe('GET /todos/:id', () => {
  it('devuelve el todo', async () => {
    const res  = await req('GET', `/todos/${todoId}`, undefined, bearer());
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.id).toBe(todoId);
    expect(body.completed).toBe(false);
  });

  it('devuelve 404 para id inexistente', async () => {
    const res = await req('GET', '/todos/no-existe', undefined, bearer());
    expect(res.status).toBe(404);
  });
});

describe('PUT /todos/:id', () => {
  it('devuelve 401 sin token', async () => {
    const res = await req('PUT', `/todos/${todoId}`, { completed: true });
    expect(res.status).toBe(401);
  });

  it('marca como completado', async () => {
    const res  = await req('PUT', `/todos/${todoId}`, { completed: true }, bearer());
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.completed).toBe(true);
  });

  it('actualiza el título', async () => {
    const res  = await req('PUT', `/todos/${todoId}`, { title: 'Comprar leche de almendra' }, bearer());
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.title).toBe('Comprar leche de almendra');
    expect(body.completed).toBe(true);  // mantiene el estado
  });

  it('devuelve 400 si body está vacío', async () => {
    const res = await req('PUT', `/todos/${todoId}`, {}, bearer());
    expect(res.status).toBe(400);
  });

  it('devuelve 404 para id inexistente', async () => {
    const res = await req('PUT', '/todos/no-existe', { title: 'X' }, bearer());
    expect(res.status).toBe(404);
  });
});

describe('GET /todos?completed filter', () => {
  it('filtra completados (?completed=true)', async () => {
    const res  = await req('GET', '/todos?completed=true', undefined, bearer());
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.todos.every((t: any) => t.completed === true)).toBe(true);
  });

  it('filtra pendientes (?completed=false)', async () => {
    const res  = await req('GET', '/todos?completed=false', undefined, bearer());
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.todos.every((t: any) => t.completed === false)).toBe(true);
  });
});

describe('DELETE /todos/:id', () => {
  it('devuelve 401 sin token', async () => {
    const res = await req('DELETE', `/todos/${todoId}`);
    expect(res.status).toBe(401);
  });

  it('elimina el todo', async () => {
    const res  = await req('DELETE', `/todos/${todoId}`, undefined, bearer());
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('devuelve 404 al buscar el todo eliminado', async () => {
    const res = await req('GET', `/todos/${todoId}`, undefined, bearer());
    expect(res.status).toBe(404);
  });

  it('devuelve 404 al eliminar de nuevo', async () => {
    const res = await req('DELETE', `/todos/${todoId}`, undefined, bearer());
    expect(res.status).toBe(404);
  });
});

describe('DELETE /categories/:id', () => {
  it('devuelve 401 sin token', async () => {
    const res = await req('DELETE', `/categories/${categoryId}`);
    expect(res.status).toBe(401);
  });

  it('elimina la categoría', async () => {
    const res  = await req('DELETE', `/categories/${categoryId}`, undefined, bearer());
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('devuelve 404 al intentar eliminar de nuevo', async () => {
    const res = await req('DELETE', `/categories/${categoryId}`, undefined, bearer());
    expect(res.status).toBe(404);
  });
});

// ─── OpenAPI / Swagger ────────────────────────────────────────────────────────

describe('OpenAPI / Swagger', () => {
  it('GET /openapi.json devuelve spec correcta', async () => {
    const res  = await req('GET', '/openapi.json');
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.openapi).toBe('3.0.0');
    expect(body.info.title).toBe('Todos Fullstack API');
    expect(body.paths).toBeDefined();
  });

  it('GET /docs devuelve Swagger UI HTML', async () => {
    const res  = await req('GET', '/docs');
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('swagger');
  });
});
