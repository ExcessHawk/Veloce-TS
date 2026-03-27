// OpenAPI Generator - Generates OpenAPI 3.0 specification from metadata
import type { 
  OpenAPISpec, 
  RouteMetadata, 
  ParameterMetadata,
  ResponseMetadata,
  OpenAPIOptions 
} from '../types';
import type { MetadataRegistry } from '../core/metadata';
import type { ZodSchema } from 'zod';
import { ZodToJsonSchemaConverter } from './zod-to-json-schema';

/**
 * OpenAPIGenerator generates OpenAPI 3.0 specification from route metadata
 */
export class OpenAPIGenerator {
  private options: Required<OpenAPIOptions>;
  private converter?: ZodToJsonSchemaConverter;

  constructor(
    private metadata: MetadataRegistry,
    options?: OpenAPIOptions
  ) {
    this.options = {
      title: options?.title || 'Veloce-TS API',
      version: options?.version || '1.0.0',
      description: options?.description || 'API built with Veloce-TS',
      path: options?.path || '/openapi.json',
      docsPath: options?.docsPath || '/docs',
      docs: options?.docs !== false
    };
  }

  /**
   * Derive a human-readable tag from a route path.
   * "/products/:id" → "Products", "/api/v1/users" → "Users"
   */
  private static tagFromPath(path: string): string {
    const segments = path.split('/').filter(Boolean);
    // Skip generic version/api prefix segments
    const skip = new Set(['api', 'v1', 'v2', 'v3']);
    for (const seg of segments) {
      if (!skip.has(seg.toLowerCase()) && !seg.startsWith(':') && !seg.startsWith('{')) {
        return seg.charAt(0).toUpperCase() + seg.slice(1);
      }
    }
    return 'Default';
  }

  /**
   * Returns true when the route has any auth-related metadata,
   * meaning it should carry the Bearer security requirement in OpenAPI.
   */
  private static isSecured(route: RouteMetadata): boolean {
    return !!(route.auth || route.roles || route.permissions || route.minimumRole);
  }

  /**
   * Generate complete OpenAPI 3.0 specification
   */
  generate(): OpenAPISpec {
    const routes = this.metadata.getRoutes();

    const spec: OpenAPISpec = {
      openapi: '3.0.0',
      info: {
        title: this.options.title,
        version: this.options.version,
        description: this.options.description
      },
      paths: {},
      // Security scheme so Swagger UI can send Bearer tokens
      components: {
        schemas: {},
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'JWT access token — include as: Authorization: Bearer <token>',
          },
        },
      },
      // Collect unique tags (auto-generated from route prefixes)
      tags: [],
    };

    // Initialize converter with spec reference
    this.converter = new ZodToJsonSchemaConverter(spec);

    const tagSet = new Set<string>();

    // Process each route and add to spec
    for (const route of routes) {
      const tag = OpenAPIGenerator.tagFromPath(route.path);
      tagSet.add(tag);
      this.addRouteToSpec(spec, route, tag);
    }

    // Populate tags array
    (spec as any).tags = Array.from(tagSet).map(name => ({ name }));

    return spec;
  }

  /**
   * Add a single route to the OpenAPI specification
   */
  private addRouteToSpec(spec: OpenAPISpec, route: RouteMetadata, autoTag: string): void {
    const path = this.convertPathToOpenAPI(route.path);
    const method = route.method.toLowerCase();

    // Skip if method is 'all' or 'options' (not standard OpenAPI methods)
    if (method === 'all' || method === 'options') {
      return;
    }

    // Initialize path object if it doesn't exist
    if (!spec.paths[path]) {
      spec.paths[path] = {};
    }

    // Merge explicit tags with the auto-derived tag
    const tags: string[] = route.docs?.tags?.length
      ? route.docs.tags
      : [autoTag];

    // Determine the effective success status code for this route
    const successCode: number = (route as any).statusCode ?? 200;

    // Build operation object
    const operation: any = {
      summary: route.docs?.summary,
      description: route.docs?.description,
      tags,
      deprecated: route.docs?.deprecated || false,
      parameters: this.extractParameters(route, spec),
      responses: this.extractResponses(route, spec, successCode),
    };

    // Extract request body if present
    const requestBody = this.extractRequestBody(route, spec);
    if (requestBody) {
      operation.requestBody = requestBody;
    }

    // Remove empty arrays/objects
    if (operation.parameters.length === 0) {
      delete operation.parameters;
    }

    // Attach Bearer security requirement for protected routes
    if (OpenAPIGenerator.isSecured(route)) {
      operation.security = [{ bearerAuth: [] }];
    }

    // Add operation to spec
    spec.paths[path][method] = operation;
  }

  /**
   * Extract parameters (query, path, header, cookie) from route metadata
   */
  private extractParameters(route: RouteMetadata, spec: OpenAPISpec): any[] {
    const parameters: any[] = [];

    for (const param of route.parameters) {
      if (param.type === 'query' || param.type === 'param' || param.type === 'header' || param.type === 'cookie') {
        const paramSpec = this.parameterToOpenAPI(param, route.path, spec);
        if (paramSpec) {
          parameters.push(paramSpec);
        }
      }
    }

    return parameters;
  }

  /**
   * Extract request body from @Body parameters
   */
  private extractRequestBody(route: RouteMetadata, spec: OpenAPISpec): any | null {
    const bodyParam = route.parameters.find(p => p.type === 'body');

    if (!bodyParam || !bodyParam.schema) {
      return null;
    }

    return {
      required: bodyParam.required,
      content: {
        'application/json': {
          schema: this.zodToOpenAPISchema(bodyParam.schema, spec)
        }
      }
    };
  }

  /**
   * Extract responses from route metadata.
   * @param successCode - The HTTP status code for the primary success response.
   */
  private extractResponses(route: RouteMetadata, spec: OpenAPISpec, successCode: number = 200): Record<string, any> {
    const responses: Record<string, any> = {};

    // Add documented responses (from @ApiResponse or @ResponseSchema)
    if (route.responses && route.responses.length > 0) {
      for (const response of route.responses) {
        responses[response.statusCode.toString()] = {
          description: response.description || this.getDefaultResponseDescription(response.statusCode),
          content: response.schema ? {
            'application/json': {
              schema: this.zodToOpenAPISchema(response.schema, spec)
            }
          } : undefined
        };
      }
    }

    // Ensure the primary success response is present
    const successKey = successCode.toString();
    if (!responses[successKey]) {
      const responseSchema = (route as any).responseSchema;
      responses[successKey] = {
        description: this.getDefaultResponseDescription(successCode),
        content: {
          'application/json': {
            schema: responseSchema
              ? this.zodToOpenAPISchema(responseSchema, spec)
              : { type: 'object' }
          }
        }
      };
    }

    // Always document the 422 validation error response
    if (!responses['422']) {
      responses['422'] = {
        description: 'Validation error',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                error: { type: 'string' },
                statusCode: { type: 'number', example: 422 },
                details: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      path: { type: 'string' },
                      message: { type: 'string' },
                      code: { type: 'string' }
                    }
                  }
                }
              }
            }
          }
        }
      };
    }

    // Document 401 for secured routes
    if (OpenAPIGenerator.isSecured(route) && !responses['401']) {
      responses['401'] = {
        description: 'Unauthorized — missing or invalid JWT token',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                error: { type: 'string' },
                statusCode: { type: 'number', example: 401 }
              }
            }
          }
        }
      };
    }

    return responses;
  }

  /**
   * Convert FastAPI-TS path format to OpenAPI format
   * Converts :param to {param}
   */
  private convertPathToOpenAPI(path: string): string {
    return path.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, '{$1}');
  }

  /**
   * Convert parameter metadata to OpenAPI parameter object
   */
  private parameterToOpenAPI(param: ParameterMetadata, routePath: string, spec: OpenAPISpec): any | null {
    let inValue: string;
    let name: string;

    switch (param.type) {
      case 'query':
        inValue = 'query';
        name = param.name || 'query';
        break;
      case 'param':
        inValue = 'path';
        // Extract parameter name from route path if not specified
        if (param.name) {
          name = param.name;
        } else {
          // Try to extract from path
          const match = routePath.match(/:([a-zA-Z_][a-zA-Z0-9_]*)/);
          name = match ? match[1] : 'id';
        }
        break;
      case 'header':
        inValue = 'header';
        name = param.name || 'X-Custom-Header';
        break;
      case 'cookie':
        inValue = 'cookie';
        name = param.name || 'session';
        break;
      default:
        return null;
    }

    const paramSpec: any = {
      name,
      in: inValue,
      required: param.required || inValue === 'path', // Path params are always required
      schema: param.schema 
        ? this.zodToOpenAPISchema(param.schema, spec)
        : { type: 'string' }
    };

    return paramSpec;
  }

  /**
   * Convert Zod schema to OpenAPI schema
   * Uses our custom converter that handles reusable schemas
   */
  private zodToOpenAPISchema(schema: ZodSchema, spec: OpenAPISpec): any {
    if (!this.converter) {
      this.converter = new ZodToJsonSchemaConverter(spec);
    }
    return this.converter.convert(schema);
  }

  /**
   * Get default response description for status code
   */
  private getDefaultResponseDescription(statusCode: number): string {
    const descriptions: Record<number, string> = {
      200: 'Successful response',
      201: 'Created',
      204: 'No content',
      400: 'Bad request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not found',
      422: 'Validation error',
      500: 'Internal server error'
    };

    return descriptions[statusCode] || 'Response';
  }
}
