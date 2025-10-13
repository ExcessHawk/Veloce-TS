import type { Context, Middleware, CompressionOptions } from '../types';

/**
 * Create compression middleware
 * Compresses responses with gzip or brotli based on Accept-Encoding header
 */
export function createCompressionMiddleware(options?: CompressionOptions): Middleware {
  const {
    threshold = 1024, // Only compress responses larger than 1KB
    level = 6 // Compression level (1-9 for gzip, 0-11 for brotli)
  } = options || {};

  return async (c: Context, next) => {
    // Continue to next middleware/handler first
    await next();

    // Get the response
    const response = c.res;
    if (!response) {
      return;
    }

    // Check if response should be compressed
    const contentType = response.headers.get('content-type') || '';
    const contentLength = response.headers.get('content-length');
    const acceptEncoding = c.req.header('accept-encoding') || '';

    // Skip compression for certain content types
    const compressibleTypes = [
      'text/',
      'application/json',
      'application/javascript',
      'application/xml',
      'application/x-www-form-urlencoded'
    ];

    const isCompressible = compressibleTypes.some(type => 
      contentType.toLowerCase().includes(type)
    );

    if (!isCompressible) {
      return;
    }

    // Skip if response is too small
    if (contentLength && parseInt(contentLength) < threshold) {
      return;
    }

    // Skip if already encoded
    if (response.headers.get('content-encoding')) {
      return;
    }

    // Get response body
    const body = await response.arrayBuffer();
    
    // Skip if body is too small
    if (body.byteLength < threshold) {
      return;
    }

    // Determine compression method
    let compressed: Uint8Array | null = null;
    let encoding: string | null = null;

    // Try brotli first (better compression)
    if (acceptEncoding.includes('br') && typeof CompressionStream !== 'undefined') {
      try {
        const stream = new CompressionStream('deflate');
        const writer = stream.writable.getWriter();
        writer.write(new Uint8Array(body));
        writer.close();
        
        const reader = stream.readable.getReader();
        const chunks: Uint8Array[] = [];
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        
        const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          result.set(chunk, offset);
          offset += chunk.length;
        }
        
        compressed = result;
        encoding = 'deflate';
      } catch (error) {
        // Fallback to gzip
        compressed = null;
      }
    }

    // Try gzip if brotli not available or failed
    if (!compressed && acceptEncoding.includes('gzip') && typeof CompressionStream !== 'undefined') {
      try {
        const stream = new CompressionStream('gzip');
        const writer = stream.writable.getWriter();
        writer.write(new Uint8Array(body));
        writer.close();
        
        const reader = stream.readable.getReader();
        const chunks: Uint8Array[] = [];
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        
        const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          result.set(chunk, offset);
          offset += chunk.length;
        }
        
        compressed = result;
        encoding = 'gzip';
      } catch (error) {
        // Compression failed, use original
        compressed = null;
      }
    }

    // If compression succeeded and resulted in smaller size, use it
    if (compressed && encoding && compressed.byteLength < body.byteLength) {
      // Create new response with compressed body
      const headers = new Headers(response.headers);
      headers.set('content-encoding', encoding);
      headers.set('content-length', compressed.byteLength.toString());
      headers.delete('content-length'); // Let the runtime set it
      
      // Update the response
      const newResponse = new Response(compressed, {
        status: response.status,
        statusText: response.statusText,
        headers
      });

      // Replace the response in context
      // Note: This is a workaround since Hono's context doesn't allow direct response replacement
      // In practice, this middleware should be used with Hono's compress middleware
      return newResponse;
    }
  };
}
