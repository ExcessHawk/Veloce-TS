// Documentation decorators for OpenAPI documentation
import { MetadataRegistry } from '../core/metadata';
import type { RouteDocumentation, ResponseMetadata } from '../types';

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
