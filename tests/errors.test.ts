import { describe, it } from 'bun:test';
import 'reflect-metadata';
import { setupTestApp } from '../src/testing/helpers';
import { Controller, Get, Post } from '../src/decorators/http';
import {
  HTTPException,
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  GoneException,
  PayloadTooLargeException,
  UnprocessableEntityException,
  TooManyRequestsException,
  ServiceUnavailableException,
} from '../src/errors/exceptions';
import { PROBLEM_JSON_MEDIA_TYPE } from '../src/errors/problem-details';

// ── Exception classes ─────────────────────────────────────────────────────────

describe('HTTP Exception classes', () => {
  it('HTTPException holds correct statusCode and message', () => {
    const err = new HTTPException(418, "I'm a teapot");
    if (err.statusCode !== 418) throw new Error('Wrong status code');
    if (err.message !== "I'm a teapot") throw new Error('Wrong message');
  });

  it('toJSON includes RFC 9457 fields and legacy mirrors', () => {
    const err = new HTTPException(500, 'Server Error', { info: 'db down' });
    const json = err.toJSON() as Record<string, unknown>;
    if (json.status !== 500) throw new Error('Missing RFC status in JSON');
    if (json.statusCode !== 500) throw new Error('Missing statusCode in JSON');
    if (json.detail !== 'Server Error') throw new Error('Missing detail in JSON');
    if (json.error !== 'Server Error') throw new Error('Missing legacy error in JSON');
    if (typeof json.type !== 'string' || !(json.type as string).includes('problems')) {
      throw new Error('Missing or invalid type URI');
    }
    if (!json.details) throw new Error('Missing details in JSON');
  });

  const cases: [string, () => HTTPException, number][] = [
    ['NotFoundException', () => new NotFoundException(), 404],
    ['UnauthorizedException', () => new UnauthorizedException(), 401],
    ['ForbiddenException', () => new ForbiddenException(), 403],
    ['BadRequestException', () => new BadRequestException(), 400],
    ['ConflictException', () => new ConflictException(), 409],
    ['GoneException', () => new GoneException(), 410],
    ['PayloadTooLargeException', () => new PayloadTooLargeException(), 413],
    ['UnprocessableEntityException', () => new UnprocessableEntityException(), 422],
    ['TooManyRequestsException', () => new TooManyRequestsException(), 429],
    ['ServiceUnavailableException', () => new ServiceUnavailableException(), 503],
  ];

  for (const [name, factory, code] of cases) {
    it(`${name} has status ${code}`, () => {
      const err = factory();
      if (err.statusCode !== code) {
        throw new Error(`${name}: expected ${code}, got ${err.statusCode}`);
      }
      if (!(err instanceof HTTPException)) {
        throw new Error(`${name} should extend HTTPException`);
      }
    });
  }

  it('custom message overrides the default', () => {
    const err = new NotFoundException('Order not found');
    if (err.message !== 'Order not found') throw new Error('Custom message not set');
  });
});

// ── Framework error handling ──────────────────────────────────────────────────

describe('Error handling in routes', () => {
  @Controller('/guarded')
  class GuardedController {
    @Get('/auth')
    auth() {
      throw new UnauthorizedException('Token missing');
    }

    @Get('/forbidden')
    forbidden() {
      throw new ForbiddenException();
    }

    @Get('/missing')
    missing() {
      throw new NotFoundException('Resource not found');
    }

    @Get('/conflict')
    conflict() {
      throw new ConflictException('Email already in use');
    }

    @Post('/heavy')
    heavy() {
      throw new PayloadTooLargeException();
    }

    @Get('/unavailable')
    unavailable() {
      throw new ServiceUnavailableException('Maintenance window');
    }
  }

  it('NotFoundException returns 404', async () => {
    const { client } = await setupTestApp((app) => {
      app.include(GuardedController);
    });
    const res = await client.get('/guarded/missing');
    res.expectNotFound();
  });

  it('default error responses use application/problem+json (RFC 9457)', async () => {
    const { client } = await setupTestApp((app) => {
      app.include(GuardedController);
    });
    const res = await client.get('/guarded/missing');
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes(PROBLEM_JSON_MEDIA_TYPE)) {
      throw new Error(`Expected Content-Type to include ${PROBLEM_JSON_MEDIA_TYPE}, got: ${ct}`);
    }
    const body = res.body as Record<string, unknown>;
    if (typeof body.instance !== 'string') throw new Error('Expected instance URI');
    if (body.status !== 404) throw new Error('Expected RFC status 404');
  });

  it('legacy error format omits problem+json', async () => {
    const { client } = await setupTestApp(
      (app) => {
        app.include(GuardedController);
      },
      { errorResponseFormat: 'legacy' }
    );
    const res = await client.get('/guarded/missing');
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('problem+json')) {
      throw new Error('Legacy format should not use problem+json');
    }
    res.expectField('statusCode', 404).expectField('error', 'Resource not found');
  });

  it('UnauthorizedException returns 401', async () => {
    const { client } = await setupTestApp((app) => {
      app.include(GuardedController);
    });
    const res = await client.get('/guarded/auth');
    res.expectUnauthorized();
  });

  it('ForbiddenException returns 403', async () => {
    const { client } = await setupTestApp((app) => {
      app.include(GuardedController);
    });
    const res = await client.get('/guarded/forbidden');
    res.expectForbidden();
  });

  it('ConflictException returns 409', async () => {
    const { client } = await setupTestApp((app) => {
      app.include(GuardedController);
    });
    const res = await client.get('/guarded/conflict');
    res.expectStatus(409);
  });

  it('PayloadTooLargeException returns 413', async () => {
    const { client } = await setupTestApp((app) => {
      app.include(GuardedController);
    });
    const res = await client.post('/guarded/heavy');
    res.expectStatus(413);
  });

  it('ServiceUnavailableException returns 503', async () => {
    const { client } = await setupTestApp((app) => {
      app.include(GuardedController);
    });
    const res = await client.get('/guarded/unavailable');
    res.expectStatus(503);
  });

  it('unhandled errors return 500', async () => {
    const { client } = await setupTestApp((app) => {
      app.get('/boom', {
        handler: () => {
          throw new Error('Something exploded');
        },
      });
    });
    const res = await client.get('/boom');
    res.expectStatus(500);
  });

  it('custom onError handler is called', async () => {
    const { app, client } = await setupTestApp((app) => {
      app.get('/fail', {
        handler: () => { throw new Error('Intentional'); },
      });
    });

    app.onError(async (err, c) => {
      return c.json({ custom: true, msg: err.message }, 500);
    });

    const res = await client.get('/fail');
    res.expectStatus(500).expectJson({ custom: true });
  });
});
