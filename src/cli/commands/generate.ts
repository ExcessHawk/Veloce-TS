import { Command } from 'commander';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

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
}

async function generateOpenAPI(options: { output: string }): Promise<void> {
  console.log('Generating OpenAPI specification...');

  try {
    // Import the application to extract metadata
    const appPath = join(process.cwd(), 'src', 'index.ts');

    if (!existsSync(appPath)) {
      console.error('Error: src/index.ts not found');
      console.error('Make sure you are in a FastAPI-TS project directory');
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

    // Generate OpenAPI spec from metadata
    const metadata = app.getMetadata();
    const spec = generateOpenAPISpec(metadata, app);

    // Write to file
    const outputPath = join(process.cwd(), options.output);
    await writeFile(outputPath, JSON.stringify(spec, null, 2));

    console.log(`✓ OpenAPI spec generated: ${options.output}`);
  } catch (error) {
    console.error('Failed to generate OpenAPI spec:', error);
    process.exit(1);
  }
}

function generateOpenAPISpec(metadata: any, app: any): any {
  const routes = metadata.getRoutes();

  const spec = {
    openapi: '3.0.0',
    info: {
      title: app.config?.title || 'Veloce API',
      version: app.config?.version || '1.0.0',
      description: app.config?.description || 'API built with Veloce',
    },
    paths: {} as Record<string, any>,
    components: {
      schemas: {},
    },
  };

  // Build paths from routes
  for (const route of routes) {
    const path = route.path;
    const method = route.method.toLowerCase();

    if (!spec.paths[path]) {
      spec.paths[path] = {};
    }

    spec.paths[path][method] = {
      summary: route.docs?.summary || `${method.toUpperCase()} ${path}`,
      description: route.docs?.description,
      tags: route.docs?.tags || [],
      parameters: extractParameters(route),
      requestBody: extractRequestBody(route),
      responses: {
        '200': {
          description: 'Successful response',
          content: {
            'application/json': {
              schema: { type: 'object' },
            },
          },
        },
      },
    };
  }

  return spec;
}

function extractParameters(route: any): any[] {
  const params: any[] = [];

  for (const param of route.parameters || []) {
    if (param.type === 'query' || param.type === 'param' || param.type === 'header') {
      params.push({
        name: param.name || 'unknown',
        in: param.type === 'param' ? 'path' : param.type,
        required: param.required || false,
        schema: { type: 'string' },
      });
    }
  }

  return params;
}

function extractRequestBody(route: any): any | undefined {
  const bodyParam = route.parameters?.find((p: any) => p.type === 'body');

  if (!bodyParam) {
    return undefined;
  }

  return {
    required: true,
    content: {
      'application/json': {
        schema: { type: 'object' },
      },
    },
  };
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
    const spec = JSON.parse(specFile);

    // Create output directory
    const outputDir = join(process.cwd(), options.output);
    await mkdir(outputDir, { recursive: true });

    // Generate client code
    const clientCode = generateClientCode(spec);

    // Write client file
    const clientPath = join(outputDir, 'client.ts');
    await writeFile(clientPath, clientCode);

    // Generate types file
    const typesCode = generateTypesCode(spec);
    const typesPath = join(outputDir, 'types.ts');
    await writeFile(typesPath, typesCode);

    console.log(`✓ TypeScript client generated in ${options.output}`);
    console.log(`  - ${options.output}/client.ts`);
    console.log(`  - ${options.output}/types.ts`);
  } catch (error) {
    console.error('Failed to generate client:', error);
    process.exit(1);
  }
}

function generateClientCode(spec: any): string {
  const baseUrl = spec.servers?.[0]?.url || 'http://localhost:3000';

  let code = `// Generated TypeScript client for ${spec.info.title}
// Version: ${spec.info.version}

import type * as Types from './types';

export class APIClient {
  constructor(private baseUrl: string = '${baseUrl}') {}

  private async request<T>(
    method: string,
    path: string,
    options?: {
      params?: Record<string, any>;
      body?: any;
      headers?: Record<string, string>;
    }
  ): Promise<T> {
    const url = new URL(path, this.baseUrl);

    if (options?.params) {
      Object.entries(options.params).forEach(([key, value]) => {
        url.searchParams.append(key, String(value));
      });
    }

    const response = await fetch(url.toString(), {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      throw new Error(\`API request failed: \${response.statusText}\`);
    }

    return response.json();
  }

`;

  // Generate methods for each endpoint
  for (const [path, methods] of Object.entries(spec.paths || {})) {
    for (const [method, operation] of Object.entries(methods as any)) {
      const methodName = generateMethodName(method, path, operation);
      const methodCode = generateMethodCode(method, path, operation);
      code += methodCode + '\n';
    }
  }

  code += '}\n';

  return code;
}

function generateMethodName(method: string, path: string, operation: any): string {
  // Use operationId if available, otherwise generate from path
  if (operation.operationId) {
    return operation.operationId;
  }

  // Convert path to camelCase method name
  const cleanPath = path
    .replace(/\{|\}/g, '')
    .replace(/\//g, '_')
    .replace(/^_/, '')
    .replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());

  return `${method}${cleanPath.charAt(0).toUpperCase() + cleanPath.slice(1)}`;
}

function generateMethodCode(method: string, path: string, operation: any): string {
  const methodName = generateMethodName(method, path, operation);
  const hasBody = method === 'post' || method === 'put' || method === 'patch';
  const hasParams = operation.parameters?.some((p: any) => p.in === 'query');
  const hasPathParams = operation.parameters?.some((p: any) => p.in === 'path');

  let params: string[] = [];
  let pathParamNames: string[] = [];

  if (hasPathParams) {
    const pathParams = operation.parameters.filter((p: any) => p.in === 'path');
    pathParamNames = pathParams.map((p: any) => p.name);
    params.push(...pathParams.map((p: any) => `${p.name}: string`));
  }

  if (hasBody) {
    params.push('body: any');
  }

  if (hasParams) {
    params.push('params?: Record<string, any>');
  }

  const paramsStr = params.length > 0 ? params.join(', ') : '';

  // Replace path parameters
  let finalPath = path;
  for (const paramName of pathParamNames) {
    finalPath = finalPath.replace(`{${paramName}}`, `\${${paramName}}`);
  }

  return `  async ${methodName}(${paramsStr}): Promise<any> {
    return this.request('${method.toUpperCase()}', \`${finalPath}\`, {
      ${hasBody ? 'body,' : ''}
      ${hasParams ? 'params,' : ''}
    });
  }
`;
}

function generateTypesCode(spec: any): string {
  let code = `// Generated types for ${spec.info.title}
// Version: ${spec.info.version}

`;

  // Generate types from schemas
  if (spec.components?.schemas) {
    for (const [name, schema] of Object.entries(spec.components.schemas)) {
      code += `export interface ${name} {\n`;
      code += generateInterfaceProperties(schema as any);
      code += '}\n\n';
    }
  }

  return code;
}

function generateInterfaceProperties(schema: any, indent: string = '  '): string {
  let props = '';

  if (schema.properties) {
    for (const [propName, propSchema] of Object.entries(schema.properties)) {
      const prop = propSchema as any;
      const optional = !schema.required?.includes(propName);
      const type = mapJsonSchemaType(prop);
      props += `${indent}${propName}${optional ? '?' : ''}: ${type};\n`;
    }
  }

  return props;
}

function mapJsonSchemaType(schema: any): string {
  if (schema.type === 'string') return 'string';
  if (schema.type === 'number' || schema.type === 'integer') return 'number';
  if (schema.type === 'boolean') return 'boolean';
  if (schema.type === 'array') {
    const itemType = schema.items ? mapJsonSchemaType(schema.items) : 'any';
    return `${itemType}[]`;
  }
  if (schema.type === 'object') return 'Record<string, any>';
  return 'any';
}
