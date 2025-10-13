// Response builders for different content types
import type { Context } from '../types';

export interface FileOptions {
  filename?: string;
  contentType?: string;
  download?: boolean;
}

export interface StreamOptions {
  contentType?: string;
  headers?: Record<string, string>;
}

/**
 * Response builder class providing static factory methods
 * for creating different types of HTTP responses
 * 
 * @example
 * ```typescript
 * // Return JSON response
 * return Response.json({ id: 1, name: 'John' });
 * 
 * // Return HTML
 * return Response.html('<h1>Hello World</h1>');
 * 
 * // Serve a file
 * return Response.file('./uploads/document.pdf', { download: true });
 * 
 * // Redirect
 * return Response.redirect('/login', 302);
 * ```
 */
export class Response {
  /**
   * Create a JSON response
   * @param data - The data to serialize as JSON
   * @param status - HTTP status code (default: 200)
   * @param headers - Optional custom headers
   * @returns JSONResponse instance
   * 
   * @example
   * ```typescript
   * @Get('/users/:id')
   * getUser(@Param('id') id: string) {
   *   return Response.json({ id, name: 'John' }, 200);
   * }
   * ```
   */
  static json(data: any, status: number = 200, headers?: Record<string, string>) {
    return new JSONResponse(data, status, headers);
  }

  /**
   * Create an HTML response
   * @param content - HTML content string
   * @param status - HTTP status code (default: 200)
   * @returns HTMLResponse instance
   * 
   * @example
   * ```typescript
   * @Get('/page')
   * getPage() {
   *   return Response.html('<h1>Welcome</h1>');
   * }
   * ```
   */
  static html(content: string, status: number = 200) {
    return new HTMLResponse(content, status);
  }

  /**
   * Create a file response to serve static files
   * @param path - Path to the file
   * @param options - File serving options (filename, contentType, download)
   * @returns FileResponse instance
   * 
   * @example
   * ```typescript
   * @Get('/download/:filename')
   * downloadFile(@Param('filename') filename: string) {
   *   return Response.file(`./uploads/${filename}`, { download: true });
   * }
   * ```
   */
  static file(path: string, options?: FileOptions) {
    return new FileResponse(path, options);
  }

  /**
   * Create a streaming response for large data or real-time content
   * @param stream - ReadableStream to send
   * @param options - Stream options (contentType, headers)
   * @returns StreamResponse instance
   * 
   * @example
   * ```typescript
   * @Get('/stream')
   * streamData() {
   *   const stream = new ReadableStream({
   *     start(controller) {
   *       controller.enqueue('chunk 1');
   *       controller.close();
   *     }
   *   });
   *   return Response.stream(stream, { contentType: 'text/plain' });
   * }
   * ```
   */
  static stream(stream: ReadableStream, options?: StreamOptions) {
    return new StreamResponse(stream, options);
  }

  /**
   * Create a redirect response
   * @param url - URL to redirect to
   * @param status - HTTP status code (default: 302)
   * @returns RedirectResponse instance
   * 
   * @example
   * ```typescript
   * @Post('/login')
   * login(@Body(LoginSchema) credentials: LoginData) {
   *   // ... authenticate user
   *   return Response.redirect('/dashboard', 302);
   * }
   * ```
   */
  static redirect(url: string, status: number = 302) {
    return new RedirectResponse(url, status);
  }
}

/**
 * JSON response class
 * Serializes data as JSON with specified status code and headers
 */
export class JSONResponse {
  constructor(
    public data: any,
    public status: number = 200,
    public headers: Record<string, string> = {}
  ) { }

  /**
   * Convert to Hono response format
   * @param c - Hono context
   * @returns Hono JSON response
   */
  toHonoResponse(c: Context) {
    return c.json(this.data, this.status as any, this.headers);
  }
}

/**
 * HTML response class
 * Returns HTML content with proper Content-Type header
 */
export class HTMLResponse {
  constructor(
    public content: string,
    public status: number = 200
  ) { }

  /**
   * Convert to Hono response format
   * @param c - Hono context
   * @returns Hono HTML response
   */
  toHonoResponse(c: Context) {
    return c.html(this.content, this.status as any);
  }
}

/**
 * Redirect response class
 * Performs HTTP redirect to specified URL
 */
export class RedirectResponse {
  constructor(
    public url: string,
    public status: number = 302
  ) { }

  /**
   * Convert to Hono response format
   * @param c - Hono context
   * @returns Hono redirect response
   */
  toHonoResponse(c: Context) {
    return c.redirect(this.url, this.status as any);
  }
}

/**
 * FileResponse serves a file from the filesystem
 * Supports custom filenames, content types, and download mode
 */
export class FileResponse {
  constructor(
    public path: string,
    public options?: FileOptions
  ) { }

  async toHonoResponse(c: Context) {
    try {
      // Read file using Bun's file API (works in Bun runtime)
      // For other runtimes, this would need adapter-specific implementation
      const file = typeof Bun !== 'undefined' 
        ? Bun.file(this.path)
        : await this.readFileNode(this.path);

      // Determine content type
      const contentType = this.options?.contentType || this.guessContentType(this.path);

      // Build headers
      const headers: Record<string, string> = {
        'Content-Type': contentType,
      };

      // Add Content-Disposition for downloads or custom filenames
      if (this.options?.download || this.options?.filename) {
        const filename = this.options?.filename || this.path.split('/').pop() || 'download';
        const disposition = this.options?.download ? 'attachment' : 'inline';
        headers['Content-Disposition'] = `${disposition}; filename="${filename}"`;
      }

      // Return file response
      if (typeof Bun !== 'undefined' && file instanceof Blob) {
        return c.body(file as any, 200, headers);
      } else {
        // For Node.js or other runtimes
        return c.body(file as any, 200, headers);
      }
    } catch (error) {
      // File not found or read error
      return c.json(
        { 
          error: 'File not found',
          message: error instanceof Error ? error.message : 'Unknown error'
        },
        404
      );
    }
  }

  private async readFileNode(path: string): Promise<Blob> {
    // Fallback for Node.js - would need fs module
    // This is a placeholder that works with the type system
    throw new Error('File reading in Node.js requires fs module - use Bun runtime or implement adapter');
  }

  private guessContentType(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      'html': 'text/html',
      'css': 'text/css',
      'js': 'application/javascript',
      'json': 'application/json',
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'gif': 'image/gif',
      'svg': 'image/svg+xml',
      'pdf': 'application/pdf',
      'txt': 'text/plain',
      'xml': 'application/xml',
    };
    return mimeTypes[ext || ''] || 'application/octet-stream';
  }
}

/**
 * StreamResponse sends data as a stream
 * Useful for large files, real-time data, or server-sent events
 */
export class StreamResponse {
  constructor(
    public stream: ReadableStream,
    public options?: StreamOptions
  ) { }

  toHonoResponse(c: Context) {
    const headers: Record<string, string> = {
      'Content-Type': this.options?.contentType || 'application/octet-stream',
      ...this.options?.headers,
    };

    // Return streaming response
    return c.body(this.stream as any, 200, headers);
  }
}

/**
 * ResponseSerializer handles automatic serialization of handler return values
 * Converts different return types into appropriate HTTP responses
 */
export class ResponseSerializer {
  /**
   * Serialize a handler result into an HTTP response
   * 
   * @param c - Hono context
   * @param result - The value returned from the handler
   * @returns Serialized HTTP response
   */
  static serialize(c: Context, result: any): any {
    // Handle null/undefined as 204 No Content
    if (result === null || result === undefined) {
      return c.body(null, 204);
    }

    // If result is already a native Response object, return it directly
    if (result instanceof Response) {
      return result;
    }

    // Detect custom Response instances and call toHonoResponse
    if (result instanceof JSONResponse) {
      return result.toHonoResponse(c);
    }
    
    if (result instanceof HTMLResponse) {
      return result.toHonoResponse(c);
    }
    
    if (result instanceof FileResponse) {
      return result.toHonoResponse(c);
    }
    
    if (result instanceof StreamResponse) {
      return result.toHonoResponse(c);
    }
    
    if (result instanceof RedirectResponse) {
      return result.toHonoResponse(c);
    }

    // Check for any object with toHonoResponse method (extensibility)
    if (result && typeof result.toHonoResponse === 'function') {
      return result.toHonoResponse(c);
    }

    // Default to JSON serialization for plain objects and primitives
    return c.json(result);
  }
}
