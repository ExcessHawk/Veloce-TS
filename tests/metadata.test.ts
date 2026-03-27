/**
 * Metadata registry + compiled metadata tests
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import 'reflect-metadata';
import { MetadataRegistry } from '../src/core/metadata';
import { MetadataCompiler } from '../src/core/compiled-metadata';
import { Controller, Get, Post, Put, Delete } from '../src/decorators/http';
import { Body, Param, Query } from '../src/decorators/params';
import { z } from 'zod';

// ─── Test controller ──────────────────────────────────────────────────────────

@Controller('/items')
class ItemController {
  @Get('/')
  list() { return []; }

  @Get('/:id')
  getOne(@Param('id') id: string) { return { id }; }

  @Post('/')
  create(@Body(z.object({ name: z.string() })) body: any) { return body; }

  @Put('/:id')
  update(@Param('id') id: string) { return { id }; }

  @Delete('/:id')
  remove(@Param('id') id: string) { return null; }
}

// ─── MetadataRegistry ─────────────────────────────────────────────────────────

describe('MetadataRegistry', () => {
  it('getControllerMetadata reads @Controller prefix', () => {
    const meta = MetadataRegistry.getControllerMetadata(ItemController);
    expect(meta?.prefix).toBe('/items');
  });

  it('getRouteMethods returns decorated method names', () => {
    const methods = MetadataRegistry.getRouteMethods(ItemController);
    expect(methods).toContain('list');
    expect(methods).toContain('getOne');
    expect(methods).toContain('create');
    expect(methods).toContain('update');
    expect(methods).toContain('remove');
  });

  it('getRouteMetadata has correct HTTP method and path', () => {
    const meta = MetadataRegistry.getRouteMetadata(ItemController.prototype, 'list');
    expect(meta?.method).toBe('GET');
    expect(meta?.path).toBe('/');
  });

  it('registers controller and routes via include-like pattern', () => {
    const registry = new MetadataRegistry();
    const controllerMeta = MetadataRegistry.getControllerMetadata(ItemController)!;
    registry.registerController(ItemController, controllerMeta);

    const methods = MetadataRegistry.getRouteMethods(ItemController);
    for (const method of methods) {
      const routeMeta = MetadataRegistry.getRouteMetadata(ItemController.prototype, method);
      if (routeMeta?.method && routeMeta?.path !== undefined) {
        const prefix = controllerMeta.prefix || '';
        const fullPath = [prefix, routeMeta.path].filter(Boolean).join('/').replace(/\/+/g, '/');
        registry.registerRoute({
          target: ItemController,
          propertyKey: method,
          method: routeMeta.method,
          path: fullPath,
          middleware: [],
          parameters: [],
          dependencies: [],
          responses: [],
        });
      }
    }

    const routes = registry.getRoutes();
    const paths = routes.map(r => r.path);
    expect(paths.some(p => p.includes('/items'))).toBe(true);
  });
});

// ─── MetadataCompiler ─────────────────────────────────────────────────────────

describe('MetadataCompiler', () => {
  it('compiles path regex matching :param style', () => {
    const compiled = MetadataCompiler.compile({
      target: ItemController,
      propertyKey: 'getOne',
      method: 'GET',
      path: '/items/:id',
      middleware: [],
      parameters: [],
      dependencies: [],
      responses: [],
    });
    expect(compiled.pathRegex).toBeDefined();
    expect(compiled.pathRegex!.test('/items/123')).toBe(true);
    expect(compiled.pathRegex!.test('/items/')).toBe(false);
  });

  it('hasDependencies is true when dependencies array is non-empty', () => {
    const compiled = MetadataCompiler.compile({
      target: ItemController,
      propertyKey: 'list',
      method: 'GET',
      path: '/items',
      middleware: [],
      parameters: [],
      dependencies: [{ index: 0, provider: class MyService {}, scope: 'singleton' }],
      responses: [],
    });
    expect(compiled.hasDependencies).toBe(true);
  });

  it('hasDependencies is false when no dependencies', () => {
    const compiled = MetadataCompiler.compile({
      target: ItemController,
      propertyKey: 'list',
      method: 'GET',
      path: '/items',
      middleware: [],
      parameters: [],
      dependencies: [],
      responses: [],
    });
    expect(compiled.hasDependencies).toBe(false);
  });

  it('hasBody is true when body parameter present', () => {
    const compiled = MetadataCompiler.compile({
      target: ItemController,
      propertyKey: 'create',
      method: 'POST',
      path: '/items',
      middleware: [],
      parameters: [{ index: 0, type: 'body', schema: z.object({ name: z.string() }), required: true }],
      dependencies: [],
      responses: [],
    });
    expect(compiled.hasBody).toBe(true);
  });

  it('maxArgumentIndex is the highest index across params and deps', () => {
    const compiled = MetadataCompiler.compile({
      target: ItemController,
      propertyKey: 'list',
      method: 'GET',
      path: '/items',
      middleware: [],
      parameters: [
        { index: 0, type: 'param', name: 'id', required: true },
        { index: 2, type: 'query', name: 'q', required: false },
      ],
      dependencies: [{ index: 4, provider: class S {}, scope: 'singleton' }],
      responses: [],
    });
    expect(compiled.maxArgumentIndex).toBe(4);
  });

  it('compileAll processes multiple routes', () => {
    const routes = [
      { target: ItemController, propertyKey: 'list', method: 'GET' as const, path: '/items', middleware: [], parameters: [], dependencies: [], responses: [] },
      { target: ItemController, propertyKey: 'getOne', method: 'GET' as const, path: '/items/:id', middleware: [], parameters: [], dependencies: [], responses: [] },
    ];
    const compiled = MetadataCompiler.compileAll(routes);
    expect(compiled).toHaveLength(2);
    expect(compiled[0].pathRegex).toBeDefined();
    expect(compiled[1].pathRegex).toBeDefined();
  });
});
