/**
 * Cache decorator for route handlers
 * Automatically caches responses based on route and parameters
 */

import type { CacheOptions } from '../cache/types';
import { MetadataRegistry } from '../core/metadata';

/**
 * Cache decorator - caches route responses
 * 
 * @param options - Cache configuration
 * 
 * @example
 * ```typescript
 * @Controller('/products')
 * class ProductController {
 *   @Get('/')
 *   @Cache({ ttl: '5m', key: 'products:list' })
 *   async getAllProducts() {
 *     return await db.products.findAll();
 *   }
 * 
 *   @Get('/:id')
 *   @Cache({ ttl: 300, key: 'product:{id}' }) // 5 minutes
 *   async getProduct(@Param('id') id: string) {
 *     return await db.products.findById(id);
 *   }
 * 
 *   @Get('/search')
 *   @Cache({ ttl: '1m', includeQuery: true }) // Cache varies by query params
 *   async searchProducts(@Query() query: any) {
 *     return await db.products.search(query);
 *   }
 * }
 * ```
 */
export function Cache(options: CacheOptions): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    // Store cache metadata
    Reflect.defineMetadata('cache:options', options, target, propertyKey);

    // Also store in our metadata registry for route compilation
    const existingMetadata = MetadataRegistry.getRouteMetadata(target, propertyKey as string);
    if (existingMetadata) {
      MetadataRegistry.defineRoute(target, propertyKey as string, {
        ...existingMetadata,
        cache: options
      });
    }
  };
}

/**
 * CacheInvalidate decorator - invalidates cache entries matching pattern
 * Useful for mutations that should clear related cache
 * 
 * @example
 * ```typescript
 * @Post('/')
 * @CacheInvalidate('products:*') // Clear all product caches
 * async createProduct(@Body() data: CreateProductDTO) {
 *   return await db.products.create(data);
 * }
 * 
 * @Put('/:id')
 * @CacheInvalidate(['product:{id}', 'products:*'])
 * async updateProduct(@Param('id') id: string, @Body() data: UpdateProductDTO) {
 *   return await db.products.update(id, data);
 * }
 * ```
 */
export function CacheInvalidate(pattern: string | string[]): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    const patterns = Array.isArray(pattern) ? pattern : [pattern];
    
    // Store invalidation metadata
    Reflect.defineMetadata('cache:invalidate', patterns, target, propertyKey);

    const existingMetadata = MetadataRegistry.getRouteMetadata(target, propertyKey as string);
    if (existingMetadata) {
      MetadataRegistry.defineRoute(target, propertyKey as string, {
        ...existingMetadata,
        cacheInvalidate: patterns
      });
    }
  };
}

