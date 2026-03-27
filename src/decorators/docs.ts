// Documentation decorators for OpenAPI documentation
import { MetadataRegistry } from '../core/metadata';
import type { RouteDocumentation, ResponseMetadata } from '../types';

// ---------------------------------------------------------------------------
// Shorthand decorators — simpler alternatives to @ApiDoc({...})
// ---------------------------------------------------------------------------

/**
 * Set the OpenAPI `summary` for a route (one-liner description shown in the
 * list view of Swagger UI).
 *
 * @example
 * ```ts
 * @Get('/:id')
 * @Summary('Get user by ID')
 * getUser(@Param('id') id: string) {}
 * ```
 */
export function Summary(text: string): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    const existing = MetadataRegistry.getRouteMetadata(target, propertyKey as string);
    MetadataRegistry.defineRoute(target, propertyKey as string, {
      ...existing,
      docs: { ...existing?.docs, summary: text },
    });
  };
}

/**
 * Set the OpenAPI `description` for a route (longer text shown in the expanded
 * operation detail).
 *
 * @example
 * ```ts
 * @Get('/')
 * @Description('Returns a paginated list of all users sorted by creation date.')
 * listUsers() {}
 * ```
 */
export function Description(text: string): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    const existing = MetadataRegistry.getRouteMetadata(target, propertyKey as string);
    MetadataRegistry.defineRoute(target, propertyKey as string, {
      ...existing,
      docs: { ...existing?.docs, description: text },
    });
  };
}

/**
 * Assign a single OpenAPI tag to a route.
 * Tags group operations in Swagger UI.
 * Multiple `@Tag` decorators can be stacked to assign several tags.
 *
 * @example
 * ```ts
 * @Post('/')
 * @Tag('Users')
 * @Tag('Admin')
 * createUser(@Body(UserSchema) body: User) {}
 * ```
 */
export function Tag(name: string): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    const existing = MetadataRegistry.getRouteMetadata(target, propertyKey as string);
    const currentTags = existing?.docs?.tags ?? [];
    if (!currentTags.includes(name)) {
      MetadataRegistry.defineRoute(target, propertyKey as string, {
        ...existing,
        docs: { ...existing?.docs, tags: [...currentTags, name] },
      });
    }
  };
}

/**
 * Assign multiple OpenAPI tags to a route in one decorator.
 *
 * @example
 * ```ts
 * @Get('/')
 * @Tags('Products', 'Catalog', 'Public')
 * listProducts() {}
 * ```
 */
export function Tags(...names: string[]): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    const existing = MetadataRegistry.getRouteMetadata(target, propertyKey as string);
    const currentTags = existing?.docs?.tags ?? [];
    const merged = Array.from(new Set([...currentTags, ...names]));
    MetadataRegistry.defineRoute(target, propertyKey as string, {
      ...existing,
      docs: { ...existing?.docs, tags: merged },
    });
  };
}

/**
 * Mark a route as deprecated in the OpenAPI spec.
 * Swagger UI will render it with a strikethrough.
 *
 * @example
 * ```ts
 * @Get('/legacy')
 * @Deprecated()
 * oldEndpoint() {}
 *
 * // With a migration note:
 * @Get('/legacy')
 * @Deprecated()
 * @Description('Use GET /v2/users instead.')
 * oldEndpoint() {}
 * ```
 */
export function Deprecated(): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    const existing = MetadataRegistry.getRouteMetadata(target, propertyKey as string);
    MetadataRegistry.defineRoute(target, propertyKey as string, {
      ...existing,
      docs: { ...existing?.docs, deprecated: true },
    });
  };
}

/**
 * ApiDoc decorator - adds documentation metadata to a route
 * @param docs - Documentation object with summary, description, tags, etc.
 * @example
 * ```ts
 * @ApiDoc({
 *   summary: 'Get user by ID',
 *   description: 'Retrieves a user from the database by their unique ID',
 *   tags: ['Users'],
 *   deprecated: false
 * })
 * @Get('/:id')
 * getUser(@Param('id') id: string) {}
 * ```
 */
export function ApiDoc(docs: RouteDocumentation): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    // Get existing route metadata
    const existingMetadata = MetadataRegistry.getRouteMetadata(target, propertyKey as string);
    
    // Merge documentation with existing metadata
    MetadataRegistry.defineRoute(target, propertyKey as string, {
      ...existingMetadata,
      docs: {
        ...existingMetadata?.docs,
        ...docs
      }
    });
  };
}

/**
 * ApiResponse decorator - documents a possible response for a route
 * Can be used multiple times to document different status codes
 * @param response - Response metadata with status code, description, and schema
 * @example
 * ```ts
 * @ApiResponse({
 *   statusCode: 200,
 *   description: 'User found',
 *   schema: UserSchema
 * })
 * @ApiResponse({
 *   statusCode: 404,
 *   description: 'User not found'
 * })
 * @Get('/:id')
 * getUser(@Param('id') id: string) {}
 * ```
 */
export function ApiResponse(response: ResponseMetadata): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    // Get existing route metadata
    const existingMetadata = MetadataRegistry.getRouteMetadata(target, propertyKey as string);
    
    // Get existing responses array
    const existingResponses = existingMetadata?.responses || [];
    
    // Check if a response with this status code already exists
    const existingIndex = existingResponses.findIndex(
      r => r.statusCode === response.statusCode
    );
    
    let updatedResponses: ResponseMetadata[];
    if (existingIndex >= 0) {
      // Replace existing response
      updatedResponses = [...existingResponses];
      updatedResponses[existingIndex] = response;
    } else {
      // Add new response
      updatedResponses = [...existingResponses, response];
    }
    
    // Update route metadata with new responses
    MetadataRegistry.defineRoute(target, propertyKey as string, {
      ...existingMetadata,
      responses: updatedResponses
    });
  };
}
