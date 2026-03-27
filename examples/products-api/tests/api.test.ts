/**
 * Products API – test suite
 * Runs against an in-memory SQLite database (no file created).
 *
 * Endpoints covered:
 *   POST /auth/register
 *   POST /auth/login
 *   GET  /products
 *   GET  /products/:id
 *   POST /products     (auth)
 *   PUT  /products/:id (auth)
 *   DELETE /products/:id (auth)
 *   GET  /openapi.json
 *   GET  /docs
 */
import { describe, it, expect, beforeAll } from 'bun:test';
import { createApp } from '../src/index';

// ─── helpers ──────────────────────────────────────────────────────────────────

let hono: any;
let token: string;
let productId: string;

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

// ─── setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  const app = await createApp(':memory:');
  hono = (app as any).getHono();
});

// ─── auth ─────────────────────────────────────────────────────────────────────

describe('POST /auth/register', () => {
  it('crea una cuenta y devuelve tokens', async () => {
    const res  = await req('POST', '/auth/register', {
      username: 'alice',
      email:    'alice@example.com',
      password: 'alice1234',
    });
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.user.username).toBe('alice');
    expect(body.tokens.accessToken).toBeTruthy();

    token = body.tokens.accessToken;
  });

  it('rechaza username duplicado', async () => {
    const res = await req('POST', '/auth/register', {
      username: 'alice',
      email:    'alice2@example.com',
      password: 'alice1234',
    });
    expect(res.status).toBe(400);
  });

  it('rechaza email duplicado', async () => {
    const res = await req('POST', '/auth/register', {
      username: 'alice3',
      email:    'alice@example.com',
      password: 'alice1234',
    });
    expect(res.status).toBe(400);
  });

  it('valida username mínimo 3 chars', async () => {
    const res = await req('POST', '/auth/register', {
      username: 'ab', email: 'ab@x.com', password: 'pass123',
    });
    expect(res.status).toBe(422);
  });

  it('valida formato de email', async () => {
    const res = await req('POST', '/auth/register', {
      username: 'validuser', email: 'not-email', password: 'pass123',
    });
    expect(res.status).toBe(422);
  });

  it('valida contraseña mínimo 6 chars', async () => {
    const res = await req('POST', '/auth/register', {
      username: 'validuser', email: 'v@x.com', password: '123',
    });
    expect(res.status).toBe(422);
  });
});

describe('POST /auth/login', () => {
  it('devuelve tokens con credenciales correctas', async () => {
    const res  = await req('POST', '/auth/login', {
      username: 'alice',
      password: 'alice1234',
    });
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.tokens.accessToken).toBeTruthy();
    token = body.tokens.accessToken;   // refresh token for rest of tests
  });

  it('rechaza contraseña incorrecta', async () => {
    const res = await req('POST', '/auth/login', {
      username: 'alice', password: 'wrong',
    });
    expect(res.status).toBe(401);
  });

  it('rechaza usuario inexistente', async () => {
    const res = await req('POST', '/auth/login', {
      username: 'nobody', password: 'pass',
    });
    expect(res.status).toBe(401);
  });
});

// ─── products (público) ───────────────────────────────────────────────────────

describe('GET /products', () => {
  it('devuelve lista vacía sin autenticación', async () => {
    const res  = await req('GET', '/products');
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(Array.isArray(body.products)).toBe(true);
    expect(body.total).toBe(0);
  });

  it('acepta ?search= como query param', async () => {
    const res = await req('GET', '/products?search=laptop');
    expect(res.status).toBe(200);
  });
});

// ─── products (protegidos) ────────────────────────────────────────────────────

describe('POST /products', () => {
  it('devuelve 401 sin token', async () => {
    const res = await req('POST', '/products', { name: 'Test', price: 10 });
    expect(res.status).toBe(401);
  });

  it('crea un producto con token válido', async () => {
    const res  = await req('POST', '/products', {
      name:        'Gaming Laptop',
      description: 'Alto rendimiento',
      price:       1299.99,
      stock:       5,
    }, bearer());
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.name).toBe('Gaming Laptop');
    expect(body.price).toBe(1299.99);
    expect(body.id).toBeTruthy();

    productId = body.id;
  });

  it('valida que price sea positivo', async () => {
    const res = await req('POST', '/products', { name: 'Bad', price: -5 }, bearer());
    expect(res.status).toBe(422);
  });

  it('valida que stock sea entero >= 0', async () => {
    const res = await req('POST', '/products', { name: 'Bad', price: 10, stock: -1 }, bearer());
    expect(res.status).toBe(422);
  });

  it('valida que name sea obligatorio', async () => {
    const res = await req('POST', '/products', { price: 10 }, bearer());
    expect(res.status).toBe(422);
  });
});

describe('GET /products/:id', () => {
  it('devuelve el producto (público)', async () => {
    const res  = await req('GET', `/products/${productId}`);
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.id).toBe(productId);
    expect(body.name).toBe('Gaming Laptop');
  });

  it('devuelve 404 para id inexistente', async () => {
    const res = await req('GET', '/products/no-existe');
    expect(res.status).toBe(404);
  });
});

describe('GET /products (después del insert)', () => {
  it('muestra el producto creado', async () => {
    const res  = await req('GET', '/products');
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.products[0].id).toBe(productId);
  });

  it('filtra con ?search=gaming', async () => {
    const res  = await req('GET', '/products?search=gaming');
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.total).toBe(1);
  });

  it('no retorna resultados con ?search=inexistente', async () => {
    const res  = await req('GET', '/products?search=ZZZ_NADA');
    const body = await res.json() as any;

    expect(body.total).toBe(0);
  });
});

describe('PUT /products/:id', () => {
  it('devuelve 401 sin token', async () => {
    const res = await req('PUT', `/products/${productId}`, { price: 999 });
    expect(res.status).toBe(401);
  });

  it('actualiza precio y stock', async () => {
    const res  = await req('PUT', `/products/${productId}`, {
      price: 1099.99,
      stock: 3,
    }, bearer());
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.price).toBe(1099.99);
    expect(body.stock).toBe(3);
    expect(body.name).toBe('Gaming Laptop');   // nombre no cambió
  });

  it('devuelve 404 para id inexistente', async () => {
    const res = await req('PUT', '/products/no-existe', { price: 1 }, bearer());
    expect(res.status).toBe(404);
  });

  it('devuelve 400 si body está vacío', async () => {
    const res = await req('PUT', `/products/${productId}`, {}, bearer());
    expect(res.status).toBe(400);
  });
});

describe('DELETE /products/:id', () => {
  it('devuelve 401 sin token', async () => {
    const res = await req('DELETE', `/products/${productId}`);
    expect(res.status).toBe(401);
  });

  it('elimina el producto con token válido', async () => {
    const res  = await req('DELETE', `/products/${productId}`, undefined, bearer());
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('devuelve 404 al intentar obtenerlo después de borrar', async () => {
    const res = await req('GET', `/products/${productId}`);
    expect(res.status).toBe(404);
  });

  it('devuelve 404 al intentar borrar de nuevo', async () => {
    const res = await req('DELETE', `/products/${productId}`, undefined, bearer());
    expect(res.status).toBe(404);
  });
});

// ─── OpenAPI / Swagger ────────────────────────────────────────────────────────

describe('OpenAPI / Swagger', () => {
  it('GET /openapi.json devuelve spec válida', async () => {
    const res  = await req('GET', '/openapi.json');
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.openapi).toBe('3.0.0');
    expect(body.info.title).toBe('Products API');
    expect(body.paths).toBeDefined();
  });

  it('GET /docs devuelve HTML de Swagger UI', async () => {
    const res  = await req('GET', '/docs');
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('swagger');
  });
});
