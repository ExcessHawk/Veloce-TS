import { describe, it, expect } from 'bun:test';
import 'reflect-metadata';
import { setupTestApp } from '../src/testing/helpers';
import { mockDependency, clearMocks } from '../src/testing/helpers';
import { Controller, Get, Post } from '../src/decorators/http';
import { Param, Body } from '../src/decorators/params';
import { Depends } from '../src/decorators/dependencies';
import { DIContainer } from '../src/dependencies/container';
import { z } from 'zod';

// ── Service classes used in tests ─────────────────────────────────────────────

class GreetingService {
  greet(name: string): string {
    return `Hello, ${name}!`;
  }
}

class CounterService {
  private count = 0;
  increment() { this.count++; }
  get value() { return this.count; }
}

// ── DIContainer unit tests ────────────────────────────────────────────────────

describe('DIContainer', () => {
  it('resolves a registered singleton', async () => {
    const container = new DIContainer();
    const instance = new GreetingService();
    container.register(GreetingService, { scope: 'singleton', factory: () => instance });

    const resolved = await container.resolve(GreetingService);
    if (resolved !== instance) throw new Error('Should return the same instance');
  });

  it('singleton scope returns same instance on every resolve', async () => {
    const container = new DIContainer();
    container.register(GreetingService, {
      scope: 'singleton',
      factory: () => new GreetingService(),
    });

    const a = await container.resolve(GreetingService);
    const b = await container.resolve(GreetingService);
    if (a !== b) throw new Error('Singleton should return the same instance');
  });

  it('transient scope returns a new instance on every resolve', async () => {
    const container = new DIContainer();
    container.register(CounterService, {
      scope: 'transient',
      factory: () => new CounterService(),
    });

    const a = await container.resolve(CounterService);
    const b = await container.resolve(CounterService);
    if (a === b) throw new Error('Transient should return different instances');
  });

  it('auto-creates an unregistered class provider (no-throw)', async () => {
    const container = new DIContainer();
    // DIContainer falls back to `new Provider()` when no explicit registration exists
    const instance = await container.resolve(GreetingService);
    if (typeof instance.greet !== 'function') {
      throw new Error('Auto-created instance should be a valid GreetingService');
    }
  });

  it('clear() removes registered factory — auto-creation still works', async () => {
    const container = new DIContainer();
    const sentinel = new GreetingService();
    container.register(GreetingService, { scope: 'singleton', factory: () => sentinel });

    // Before clear: should return the sentinel
    const before = await container.resolve(GreetingService);
    if (before !== sentinel) throw new Error('Should return the registered sentinel before clear()');

    container.clear();

    // After clear: factory is gone; auto-creation returns a fresh instance (not the sentinel)
    const after = await container.resolve(GreetingService);
    if (after === sentinel) throw new Error('After clear(), the sentinel factory should no longer be used');
    if (typeof after.greet !== 'function') throw new Error('Auto-created instance should still be valid');
  });
});

// ── @Depends in route handlers ────────────────────────────────────────────────

describe('@Depends in controllers', () => {
  @Controller('/hello')
  class HelloController {
    @Get('/:name')
    greet(
      @Param('name') name: string,
      @Depends(GreetingService, 'singleton') svc: GreetingService,
    ) {
      return { message: svc.greet(name) };
    }
  }

  it('injects the service and calls it', async () => {
    const { app, client } = await setupTestApp((app) => {
      app.include(HelloController);
    });

    app.getContainer().register(GreetingService, {
      scope: 'singleton',
      factory: () => new GreetingService(),
    });

    // Re-compile is needed after container registration if done after include
    // (no-op if already compiled; here we rely on setupTestApp compiling once)
    const res = await client.get('/hello/World');
    res.expectOk().expectJson({ message: 'Hello, World!' });
  });
});

// ── mockDependency utility ────────────────────────────────────────────────────

describe('mockDependency()', () => {
  @Controller('/greet')
  class GreetController {
    @Get('/:name')
    greet(
      @Param('name') name: string,
      @Depends(GreetingService) svc: GreetingService,
    ) {
      return { message: svc.greet(name) };
    }
  }

  it('overrides a real service with a mock', async () => {
    const { app, client } = await setupTestApp((app) => {
      app.include(GreetController);
    });

    mockDependency(app, GreetingService, {
      greet: (_name: string) => 'Mocked greeting!',
    });

    const res = await client.get('/greet/Alice');
    res.expectOk().expectJson({ message: 'Mocked greeting!' });
  });
});

// ── Functional API with DI via getContainer ───────────────────────────────────

describe('DI with functional API', () => {
  it('manually registered service is usable from handler', async () => {
    const { app, client } = await setupTestApp((app) => {
      app.get('/service-test', {
        handler: async (_c) => {
          const svc = await app.getContainer().resolve(GreetingService);
          return { result: svc.greet('Framework') };
        },
      });
    });

    app.getContainer().register(GreetingService, {
      scope: 'singleton',
      factory: () => new GreetingService(),
    });

    const res = await client.get('/service-test');
    res.expectOk().expectJson({ result: 'Hello, Framework!' });
  });
});
