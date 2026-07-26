/**
 * Unit tests for the `veloce generate openapi` / `veloce generate client`
 * code-generation helpers (src/cli/commands/generate.ts).
 *
 * These cover the JSON-Schema -> TypeScript type mapper and the generated
 * client/types code, which replaced a previous implementation that typed
 * every client method as `Promise<any>` and ignored Zod entirely.
 */
import { describe, it, expect } from 'bun:test';
import {
  jsonSchemaToTs,
  generateMethodName,
  generateTypesCode,
  generateClientCode,
} from '../src/cli/commands/generate';
import type { OpenAPISpec } from '../src/types';

describe('jsonSchemaToTs', () => {
  it('maps primitive types', () => {
    expect(jsonSchemaToTs({ type: 'string' })).toBe('string');
    expect(jsonSchemaToTs({ type: 'number' })).toBe('number');
    expect(jsonSchemaToTs({ type: 'integer' })).toBe('number');
    expect(jsonSchemaToTs({ type: 'boolean' })).toBe('boolean');
  });

  it('falls back to unknown, never any', () => {
    expect(jsonSchemaToTs(undefined)).toBe('unknown');
    expect(jsonSchemaToTs({})).toBe('unknown');
    expect(jsonSchemaToTs({ type: 'something-unrecognized' })).toBe('unknown');
  });

  it('maps arrays', () => {
    expect(jsonSchemaToTs({ type: 'array', items: { type: 'string' } })).toBe('string[]');
    expect(jsonSchemaToTs({ type: 'array' })).toBe('unknown[]');
  });

  it('maps objects with required/optional properties', () => {
    const type = jsonSchemaToTs({
      type: 'object',
      properties: {
        id: { type: 'string' },
        age: { type: 'number' },
      },
      required: ['id'],
    });
    expect(type).toBe('{ id: string; age?: number }');
  });

  it('maps object schemas with no known properties to Record<string, unknown>', () => {
    expect(jsonSchemaToTs({ type: 'object' })).toBe('Record<string, unknown>');
  });

  it('maps enums to literal unions', () => {
    expect(jsonSchemaToTs({ enum: ['admin', 'user'] })).toBe('"admin" | "user"');
    expect(jsonSchemaToTs({ enum: [1, 2, 3] })).toBe('1 | 2 | 3');
  });

  it('maps oneOf/anyOf to unions and allOf to intersections', () => {
    expect(jsonSchemaToTs({ oneOf: [{ type: 'string' }, { type: 'number' }] })).toBe('string | number');
    expect(jsonSchemaToTs({ anyOf: [{ type: 'string' }, { type: 'boolean' }] })).toBe('string | boolean');
    expect(jsonSchemaToTs({ allOf: [{ type: 'string' }, { type: 'number' }] })).toBe('string & number');
  });

  it('resolves $ref to a component name, with an optional prefix', () => {
    const ref = { $ref: '#/components/schemas/User' };
    expect(jsonSchemaToTs(ref)).toBe('User');
    expect(jsonSchemaToTs(ref, { refPrefix: 'Types.' })).toBe('Types.User');
  });

  it('parenthesizes union item types before appending [] so precedence is correct', () => {
    const schema = { type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'number' }] } };
    expect(jsonSchemaToTs(schema)).toBe('(string | number)[]');
  });

  it('maps nullable (type array) schemas to a union with null', () => {
    expect(jsonSchemaToTs({ type: ['string', 'null'] })).toBe('string | null');
  });
});

describe('generateMethodName', () => {
  it('uses operationId when present', () => {
    expect(generateMethodName('get', '/users', { operationId: 'listUsers' })).toBe('listUsers');
  });

  it('derives a camelCase name from method + path otherwise', () => {
    expect(generateMethodName('get', '/users', {})).toBe('getUsers');
    expect(generateMethodName('post', '/users/{id}/items', {})).toBe('postUsersIdItems');
  });
});

describe('generateTypesCode', () => {
  const spec: OpenAPISpec = {
    openapi: '3.1.0',
    info: { title: 'T', version: '1.0.0' },
    paths: {},
    components: {
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            role: { enum: ['admin', 'user'] },
          },
          required: ['id', 'role'],
        },
        Role: { enum: ['admin', 'user'] },
      },
    },
  } as OpenAPISpec;

  it('emits an interface for object schemas', () => {
    const code = generateTypesCode(spec);
    expect(code).toContain('export interface User {');
    expect(code).toContain('id: string;');
    expect(code).toContain('role: "admin" | "user";');
  });

  it('emits a type alias for non-object schemas', () => {
    const code = generateTypesCode(spec);
    expect(code).toContain('export type Role = "admin" | "user";');
  });
});

describe('generateClientCode', () => {
  const spec: OpenAPISpec = {
    openapi: '3.1.0',
    info: { title: 'T', version: '1.0.0' },
    paths: {
      '/users': {
        post: {
          operationId: 'createUser',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreateUserBody' },
              },
            },
          },
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/User' },
                },
              },
            },
          },
        },
      },
      '/users/{id}': {
        delete: {
          operationId: 'deleteUser',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '204': {} },
        },
      },
    },
    components: { schemas: {} },
  } as OpenAPISpec;

  it('never types a method as Promise<any>', () => {
    const code = generateClientCode(spec);
    expect(code).not.toContain('any');
  });

  it('types the request body and response using the referenced component names', () => {
    const code = generateClientCode(spec);
    expect(code).toContain('async createUser(body: Types.CreateUserBody): Promise<Types.User>');
  });

  it('types a 204 response as void and path params as string', () => {
    const code = generateClientCode(spec);
    expect(code).toContain('async deleteUser(id: string): Promise<void>');
  });
});
