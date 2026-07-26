import { Command } from 'commander';
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import { OpenAPIGenerator } from '../../docs';
import type { OpenAPISpec } from '../../types';

// ── Scaffolding helpers ──────────────────────────────────────────────────────

function toPascalCase(str: string): string {
  return str
    .replace(/[-_\s](.)/g, (_, c: string) => c.toUpperCase())
    .replace(/^(.)/, (_, c: string) => c.toUpperCase());
}

function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[_\s]+/g, '-');
}

function normalizeName(input: string) {
  const kebab = toKebabCase(input);
  const pascal = toPascalCase(kebab);
  const camel = pascal.charAt(0).toLowerCase() + pascal.slice(1);
  return { pascal, kebab, camel };
}

function resolveSrcDir(): string {
  const src = join(process.cwd(), 'src');
  return existsSync(src) ? src : process.cwd();
}

async function writeGenerated(filePath: string, content: string, dryRun: boolean): Promise<void> {
  if (dryRun) {
    console.log(`[dry-run] Would write: ${filePath}`);
    console.log(content);
    return;
  }
  await mkdir(dirname(filePath), { recursive: true });
  if (existsSync(filePath)) {
    console.error(`File already exists: ${filePath}`);
    process.exit(1);
  }
  await writeFile(filePath, content);
  console.log(`Created: ${filePath}`);
}

export function registerGenerateCommand(program: Command): void {
  const generateCommand = program
    .command('generate')
    .description('Generate code and documentation')
    .alias('g');

  // Generate OpenAPI spec
  generateCommand
    .command('openapi')
    .description('Generate OpenAPI specification')
    .option('-o, --output <file>', 'Output file path', 'openapi.json')
    .action(async (options: { output: string }) => {
      await generateOpenAPI(options);
    });

  // Generate TypeScript client
  generateCommand
    .command('client')
    .description('Generate TypeScript client from OpenAPI spec')
    .option('-i, --input <file>', 'OpenAPI spec file', 'openapi.json')
    .option('-o, --output <dir>', 'Output directory', 'src/client')
    .action(async (options: { input: string; output: string }) => {
      await generateClient(options);
    });

  // ── Scaffolding subcommands ─────────────────────────────────────────────────

  generateCommand
    .command('controller <name>')
    .description('Generate a REST controller')
    .option('--flat', 'Place file in src/ instead of src/controllers/')
    .option('--dry-run', 'Preview without writing files')
    .action(async (name: string, opts: { flat?: boolean; dryRun?: boolean }) => {
      const { pascal, kebab } = normalizeName(name);
      const src = resolveSrcDir();
      const dir = opts.flat ? src : join(src, 'controllers');
      const filePath = join(dir, `${kebab}.controller.ts`);
      const content = `import { Controller, Get, Post, Put, Delete, Body, Param } from 'veloce-ts';
import { z } from 'zod';

const Create${pascal}Dto = z.object({
  // TODO: define your fields
  name: z.string(),
});

type Create${pascal}Input = z.infer<typeof Create${pascal}Dto>;

@Controller('/${kebab}s')
export class ${pascal}Controller {
  @Get('/')
  async findAll() {
    return [];
  }

  @Get('/:id')
  async findOne(@Param('id') id: string) {
    return { id };
  }

  @Post('/')
  async create(@Body(Create${pascal}Dto) body: Create${pascal}Input) {
    return body;
  }

  @Put('/:id')
  async update(@Param('id') id: string, @Body(Create${pascal}Dto.partial()) body: Partial<Create${pascal}Input>) {
    return { id, ...body };
  }

  @Delete('/:id')
  async remove(@Param('id') id: string) {
    return { id };
  }
}
`;
      await writeGenerated(filePath, content, opts.dryRun ?? false);
    });

  generateCommand
    .command('service <name>')
    .description('Generate a service class')
    .option('--flat', 'Place file in src/ instead of src/services/')
    .option('--dry-run', 'Preview without writing files')
    .action(async (name: string, opts: { flat?: boolean; dryRun?: boolean }) => {
      const { pascal, kebab } = normalizeName(name);
      const src = resolveSrcDir();
      const dir = opts.flat ? src : join(src, 'services');
      const filePath = join(dir, `${kebab}.service.ts`);
      const content = `export class ${pascal}Service {
  async findAll() {
    return [];
  }

  async findOne(id: string) {
    return { id };
  }

  async create(data: Record<string, unknown>) {
    return data;
  }

  async update(id: string, data: Record<string, unknown>) {
    return { id, ...data };
  }

  async remove(id: string) {
    return { id };
  }
}
`;
      await writeGenerated(filePath, content, opts.dryRun ?? false);
    });

  generateCommand
    .command('module <name>')
    .description('Generate a module (controller + service + dto + barrel)')
    .option('--dry-run', 'Preview without writing files')
    .action(async (name: string, opts: { dryRun?: boolean }) => {
      const { pascal, kebab } = normalizeName(name);
      const src = resolveSrcDir();
      const moduleDir = join(src, 'modules', kebab);
      const controllerContent = `import { Controller, Get, Post, Put, Delete, Body, Param } from 'veloce-ts';
import { Create${pascal}Dto, type Create${pascal}Input } from './${kebab}.dto';
import { ${pascal}Service } from './${kebab}.service';

@Controller('/${kebab}s')
export class ${pascal}Controller {
  private service = new ${pascal}Service();

  @Get('/')
  async findAll() {
    return this.service.findAll();
  }

  @Get('/:id')
  async findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post('/')
  async create(@Body(Create${pascal}Dto) body: Create${pascal}Input) {
    return this.service.create(body as Record<string, unknown>);
  }

  @Put('/:id')
  async update(@Param('id') id: string, @Body(Create${pascal}Dto.partial()) body: Partial<Create${pascal}Input>) {
    return this.service.update(id, body as Record<string, unknown>);
  }

  @Delete('/:id')
  async remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
`;
      const serviceContent = `export class ${pascal}Service {
  async findAll() {
    return [];
  }

  async findOne(id: string) {
    return { id };
  }

  async create(data: Record<string, unknown>) {
    return data;
  }

  async update(id: string, data: Record<string, unknown>) {
    return { id, ...data };
  }

  async remove(id: string) {
    return { id };
  }
}
`;
      const dtoContent = `import { z } from 'zod';

export const Create${pascal}Dto = z.object({
  // TODO: define your fields
  name: z.string(),
});

export const Update${pascal}Dto = Create${pascal}Dto.partial();

export type Create${pascal}Input = z.infer<typeof Create${pascal}Dto>;
export type Update${pascal}Input = z.infer<typeof Update${pascal}Dto>;
`;
      const barrelContent = `export { ${pascal}Controller } from './${kebab}.controller';
export { ${pascal}Service } from './${kebab}.service';
export * from './${kebab}.dto';
`;
      await writeGenerated(join(moduleDir, `${kebab}.controller.ts`), controllerContent, opts.dryRun ?? false);
      await writeGenerated(join(moduleDir, `${kebab}.service.ts`), serviceContent, opts.dryRun ?? false);
      await writeGenerated(join(moduleDir, `${kebab}.dto.ts`), dtoContent, opts.dryRun ?? false);
      await writeGenerated(join(moduleDir, `${kebab}.module.ts`), barrelContent, opts.dryRun ?? false);
      if (!opts.dryRun) {
        console.log(`\nModule created at src/modules/${kebab}/`);
        console.log(`Register in your app:\n  import { ${pascal}Controller } from './modules/${kebab}/${kebab}.module';\n  app.include(${pascal}Controller);`);
      }
    });

  generateCommand
    .command('resolver <name>')
    .description('Generate a GraphQL resolver')
    .option('--flat', 'Place file in src/ instead of src/resolvers/')
    .option('--dry-run', 'Preview without writing files')
    .action(async (name: string, opts: { flat?: boolean; dryRun?: boolean }) => {
      const { pascal, kebab, camel } = normalizeName(name);
      const src = resolveSrcDir();
      const dir = opts.flat ? src : join(src, 'resolvers');
      const filePath = join(dir, `${kebab}.resolver.ts`);
      const content = `import { Resolver, GQLQuery, GQLMutation, Arg } from 'veloce-ts/graphql';
import { z } from 'zod';

@Resolver('${camel}')
export class ${pascal}Resolver {
  private items: Array<{ id: string; name: string }> = [];

  @GQLQuery('get${pascal}s')
  async getAll() {
    return this.items;
  }

  @GQLQuery('get${pascal}')
  async getOne(@Arg('id', z.string()) id: string) {
    return this.items.find(i => i.id === id) ?? null;
  }

  @GQLMutation('create${pascal}')
  async create(@Arg('name', z.string()) name: string) {
    const item = { id: Date.now().toString(), name };
    this.items.push(item);
    return item;
  }
}
`;
      await writeGenerated(filePath, content, opts.dryRun ?? false);
    });

  generateCommand
    .command('dto <name>')
    .description('Generate a Zod DTO schema')
    .option('--flat', 'Place file in src/ instead of src/dto/')
    .option('--dry-run', 'Preview without writing files')
    .action(async (name: string, opts: { flat?: boolean; dryRun?: boolean }) => {
      const { pascal, kebab } = normalizeName(name);
      const src = resolveSrcDir();
      const dir = opts.flat ? src : join(src, 'dto');
      const filePath = join(dir, `${kebab}.dto.ts`);
      const content = `import { z } from 'zod';

export const Create${pascal}Dto = z.object({
  // TODO: define your fields
  name: z.string(),
});

export const Update${pascal}Dto = Create${pascal}Dto.partial();

export type Create${pascal}Input = z.infer<typeof Create${pascal}Dto>;
export type Update${pascal}Input = z.infer<typeof Update${pascal}Dto>;
`;
      await writeGenerated(filePath, content, opts.dryRun ?? false);
    });

  generateCommand
    .command('middleware <name>')
    .description('Generate a Hono middleware function')
    .option('--flat', 'Place file in src/ instead of src/middleware/')
    .option('--dry-run', 'Preview without writing files')
    .action(async (name: string, opts: { flat?: boolean; dryRun?: boolean }) => {
      const { pascal: _pascal, kebab, camel } = normalizeName(name);
      const src = resolveSrcDir();
      const dir = opts.flat ? src : join(src, 'middleware');
      const filePath = join(dir, `${kebab}.middleware.ts`);
      const content = `import type { Context, Next } from 'hono';

export async function ${camel}Middleware(c: Context, next: Next): Promise<void> {
  // TODO: implement middleware logic
  await next();
}
`;
      await writeGenerated(filePath, content, opts.dryRun ?? false);
    });

  generateCommand
    .command('plugin <name>')
    .description('Generate a veloce-ts plugin class')
    .option('--flat', 'Place file in src/ instead of src/plugins/')
    .option('--dry-run', 'Preview without writing files')
    .action(async (name: string, opts: { flat?: boolean; dryRun?: boolean }) => {
      const { pascal, kebab, camel } = normalizeName(name);
      const src = resolveSrcDir();
      const dir = opts.flat ? src : join(src, 'plugins');
      const filePath = join(dir, `${kebab}.plugin.ts`);
      const content = `import type { Plugin } from 'veloce-ts';
import type { VeloceTS } from 'veloce-ts';

export class ${pascal}Plugin implements Plugin {
  name = '${camel}';
  version = '1.0.0';

  async install(app: VeloceTS): Promise<void> {
    // TODO: implement plugin logic
    // app.getContainer().register(...)
    // app.getHono().use(...)
  }
}
`;
      await writeGenerated(filePath, content, opts.dryRun ?? false);
    });
}

async function generateOpenAPI(options: { output: string }): Promise<void> {
  console.log('Generating OpenAPI specification...');

  try {
    // Import the application to extract metadata
    const appPath = join(process.cwd(), 'src', 'index.ts');

    if (!existsSync(appPath)) {
      console.error('Error: src/index.ts not found');
      console.error('Make sure you are in a VeloceTS project directory');
      process.exit(1);
    }

    // Dynamically import the app
    const appModule = await import(appPath);
    const app = appModule.default || appModule.app;

    if (!app || typeof app.getMetadata !== 'function') {
      console.error('Error: Could not find VeloceTS app instance');
      console.error('Make sure your src/index.ts exports the app or sets it as default');
      process.exit(1);
    }

    // Reuse the framework's own OpenAPIGenerator (Zod-aware, reusable
    // component schemas, security requirements, etc.) instead of a
    // hand-rolled minimal builder — this keeps `veloce generate openapi`
    // byte-for-byte consistent with what the OpenAPIPlugin serves at runtime.
    const metadata = app.getMetadata();
    const config = typeof app.getConfig === 'function' ? app.getConfig() : {};
    const generator = new OpenAPIGenerator(metadata, {
      title: config?.title,
      version: config?.version,
      description: config?.description,
    });
    const spec = generator.generate();

    // Write to file
    const outputPath = join(process.cwd(), options.output);
    await writeFile(outputPath, JSON.stringify(spec, null, 2));

    console.log(`✓ OpenAPI spec generated: ${options.output}`);
  } catch (error) {
    console.error('Failed to generate OpenAPI spec:', error);
    process.exit(1);
  }
}

async function generateClient(options: { input: string; output: string }): Promise<void> {
  console.log('Generating TypeScript client...');

  try {
    const specPath = join(process.cwd(), options.input);

    if (!existsSync(specPath)) {
      console.error(`Error: OpenAPI spec not found at ${options.input}`);
      console.error('Run "veloce generate openapi" first');
      process.exit(1);
    }

    // Read OpenAPI spec
    const specFile = await Bun.file(specPath).text();
    const spec = JSON.parse(specFile) as OpenAPISpec;

    // Create output directory
    const outputDir = join(process.cwd(), options.output);
    await mkdir(outputDir, { recursive: true });

    // Generate types file first — client method signatures reference it.
    const typesCode = generateTypesCode(spec);
    const typesPath = join(outputDir, 'types.ts');
    await writeFile(typesPath, typesCode);

    // Generate client code
    const clientCode = generateClientCode(spec);
    const clientPath = join(outputDir, 'client.ts');
    await writeFile(clientPath, clientCode);

    console.log(`✓ TypeScript client generated in ${options.output}`);
    console.log(`  - ${options.output}/client.ts`);
    console.log(`  - ${options.output}/types.ts`);
  } catch (error) {
    console.error('Failed to generate client:', error);
    process.exit(1);
  }
}

// ── JSON Schema → TypeScript type mapping ───────────────────────────────────
//
// Basic but real mapping from an OpenAPI/JSON-Schema fragment to a TypeScript
// type expression string. Anything the mapper doesn't recognize falls back to
// `unknown` (never `any`) so callers still get a compiler error if they treat
// the value carelessly, instead of silently losing type safety.

interface TypeMapOptions {
  /** Prefix applied to `$ref` component names, e.g. 'Types.' from client.ts. */
  refPrefix?: string;
}

/** Extract the component name from a `#/components/schemas/Name` ref. */
function refComponentName(ref: string): string {
  const segments = ref.split('/');
  return segments[segments.length - 1] || 'unknown';
}

/** Quote an object property key only when it isn't a valid TS identifier. */
function propKey(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

/** Wrap a type expression in parens if it's a top-level union/intersection. */
function parenIfCompound(type: string): string {
  return /\s[|&]\s/.test(type) ? `(${type})` : type;
}

/**
 * Convert a JSON-Schema/OpenAPI schema fragment into a TypeScript type
 * expression. Handles: $ref, oneOf/anyOf (union), allOf (intersection),
 * enum (literal union), object/array/string/number/boolean/null, and nested
 * combinations of the above. Anything unrecognized becomes `unknown`.
 */
export function jsonSchemaToTs(schema: any, options: TypeMapOptions = {}): string {
  if (!schema || typeof schema !== 'object') return 'unknown';

  if (typeof schema.$ref === 'string') {
    return `${options.refPrefix ?? ''}${refComponentName(schema.$ref)}`;
  }

  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return schema.oneOf.map((s: any) => jsonSchemaToTs(s, options)).join(' | ');
  }
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    return schema.anyOf.map((s: any) => jsonSchemaToTs(s, options)).join(' | ');
  }
  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    return schema.allOf.map((s: any) => jsonSchemaToTs(s, options)).join(' & ');
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum
      .map((v: any) => (typeof v === 'string' ? JSON.stringify(v) : String(v)))
      .join(' | ');
  }

  const declaredType = schema.type;
  const types: string[] = Array.isArray(declaredType)
    ? declaredType
    : declaredType
      ? [declaredType]
      : [];

  if (types.length > 1) {
    return types.map((t) => primitiveOrContainer(t, schema, options)).join(' | ');
  }
  if (types.length === 1) {
    return primitiveOrContainer(types[0], schema, options);
  }

  // No explicit `type` — infer from shape (common with loosely-typed specs).
  if (schema.properties) return objectLiteral(schema, options);
  if (schema.items) return `${parenIfCompound(jsonSchemaToTs(schema.items, options))}[]`;

  return 'unknown';
}

function primitiveOrContainer(type: string, schema: any, options: TypeMapOptions): string {
  switch (type) {
    case 'string':
      return 'string';
    case 'number':
    case 'integer':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'null':
      return 'null';
    case 'array': {
      const itemType = schema.items ? jsonSchemaToTs(schema.items, options) : 'unknown';
      return `${parenIfCompound(itemType)}[]`;
    }
    case 'object':
      return objectLiteral(schema, options);
    default:
      return 'unknown';
  }
}

function objectLiteral(schema: any, options: TypeMapOptions): string {
  if (!schema.properties) {
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      return `Record<string, ${jsonSchemaToTs(schema.additionalProperties, options)}>`;
    }
    return 'Record<string, unknown>';
  }

  const required: string[] = Array.isArray(schema.required) ? schema.required : [];
  const props = Object.entries(schema.properties)
    .map(([name, propSchema]) => {
      const optional = !required.includes(name);
      return `${propKey(name)}${optional ? '?' : ''}: ${jsonSchemaToTs(propSchema, options)}`;
    })
    .join('; ');

  return props ? `{ ${props} }` : 'Record<string, unknown>';
}

// ── Client code generation ──────────────────────────────────────────────────

export function generateClientCode(spec: OpenAPISpec): string {
  const baseUrl = (spec as any).servers?.[0]?.url || 'http://localhost:3000';

  let code = `// Generated TypeScript client for ${spec.info.title}
// Version: ${spec.info.version}

import type * as Types from './types';

export class APIClient {
  constructor(private baseUrl: string = '${baseUrl}') {}

  private async request<T>(
    method: string,
    path: string,
    options?: {
      params?: Record<string, unknown>;
      body?: unknown;
      headers?: Record<string, string>;
    }
  ): Promise<T> {
    const url = new URL(path, this.baseUrl);

    if (options?.params) {
      Object.entries(options.params).forEach(([key, value]) => {
        if (value !== undefined) url.searchParams.append(key, String(value));
      });
    }

    const response = await fetch(url.toString(), {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      throw new Error(\`API request failed: \${response.statusText}\`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json();
  }

`;

  // Generate methods for each endpoint
  for (const [path, methods] of Object.entries(spec.paths || {})) {
    for (const [method, operation] of Object.entries(methods as Record<string, any>)) {
      code += generateMethodCode(method, path, operation) + '\n';
    }
  }

  code += '}\n';

  return code;
}

export function generateMethodName(method: string, path: string, operation: any): string {
  // Use operationId if available, otherwise generate from path
  if (operation.operationId) {
    return operation.operationId;
  }

  // Convert path to camelCase method name
  const cleanPath = path
    .replace(/\{|\}/g, '')
    .replace(/\//g, '_')
    .replace(/^_/, '')
    .replace(/_([a-z])/g, (_: string, letter: string) => letter.toUpperCase());

  return `${method}${cleanPath.charAt(0).toUpperCase() + cleanPath.slice(1)}`;
}

/** Resolve the TS type of a `requestBody`'s JSON content, or 'unknown'. */
function requestBodyType(operation: any): string {
  const schema = operation.requestBody?.content?.['application/json']?.schema;
  if (!schema) return 'unknown';
  return jsonSchemaToTs(schema, { refPrefix: 'Types.' });
}

/**
 * Resolve the TS type of the primary 2xx JSON response.
 * A 204 (No Content) yields `void`; a missing/undocumented body is `unknown`.
 */
function responseBodyType(operation: any): string {
  const responses: Record<string, any> = operation.responses || {};
  const successKeys = Object.keys(responses)
    .filter((k) => /^2\d\d$/.test(k))
    .sort();

  for (const key of successKeys) {
    if (key === '204') return 'void';
    const schema = responses[key]?.content?.['application/json']?.schema;
    if (schema) return jsonSchemaToTs(schema, { refPrefix: 'Types.' });
  }

  return 'unknown';
}

function generateMethodCode(method: string, path: string, operation: any): string {
  const methodName = generateMethodName(method, path, operation);
  const hasBody = method === 'post' || method === 'put' || method === 'patch';
  const allParams: any[] = operation.parameters || [];
  const pathParams = allParams.filter((p) => p.in === 'path');
  const queryParams = allParams.filter((p) => p.in === 'query');

  const params: string[] = [];
  const pathParamNames: string[] = pathParams.map((p) => p.name);
  params.push(...pathParams.map((p) => `${p.name}: string`));

  const bodyType = hasBody ? requestBodyType(operation) : undefined;
  if (hasBody) {
    params.push(`body: ${bodyType}`);
  }

  if (queryParams.length > 0) {
    const allOptional = queryParams.every((p) => !p.required);
    const queryProps = queryParams
      .map((p) => {
        const propType = jsonSchemaToTs(p.schema ?? { type: 'string' }, { refPrefix: 'Types.' });
        return `${propKey(p.name)}${p.required ? '' : '?'}: ${propType}`;
      })
      .join('; ');
    params.push(`params${allOptional ? '?' : ''}: { ${queryProps} }`);
  }

  const paramsStr = params.join(', ');

  // Replace path parameters
  let finalPath = path;
  for (const paramName of pathParamNames) {
    finalPath = finalPath.replace(`{${paramName}}`, `\${${paramName}}`);
  }

  const responseType = responseBodyType(operation);

  return `  async ${methodName}(${paramsStr}): Promise<${responseType}> {
    return this.request<${responseType}>('${method.toUpperCase()}', \`${finalPath}\`, {
      ${hasBody ? 'body,' : ''}
      ${queryParams.length > 0 ? 'params,' : ''}
    });
  }
`;
}

// ── Types file generation ────────────────────────────────────────────────────

export function generateTypesCode(spec: OpenAPISpec): string {
  let code = `// Generated types for ${spec.info.title}
// Version: ${spec.info.version}

`;

  const schemas = spec.components?.schemas || {};
  for (const [name, schema] of Object.entries(schemas)) {
    const s = schema as any;
    if (s && typeof s === 'object' && s.type === 'object' && s.properties) {
      // Object schemas become interfaces so consumers get per-property
      // docs/autocomplete instead of an opaque type alias.
      const required: string[] = Array.isArray(s.required) ? s.required : [];
      code += `export interface ${name} {\n`;
      for (const [propName, propSchema] of Object.entries(s.properties)) {
        const optional = !required.includes(propName);
        code += `  ${propKey(propName)}${optional ? '?' : ''}: ${jsonSchemaToTs(propSchema)};\n`;
      }
      code += '}\n\n';
    } else {
      // Arrays, unions, enums, primitives, etc. — a type alias.
      code += `export type ${name} = ${jsonSchemaToTs(s)};\n\n`;
    }
  }

  return code;
}
