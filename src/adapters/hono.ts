/**
 * Hono adapter for runtime-agnostic server deployment
 * Supports Bun, Node.js, Deno, and Cloudflare Workers
 */
import type { Hono } from 'hono';
import type { Adapter, ServerInstance } from './base';

// Type declarations for runtime globals
declare const Deno: any;
declare const Bun: any;

/**
 * Runtime detection utilities
 */
const detectRuntime = (): 'bun' | 'deno' | 'node' | 'workerd' | 'unknown' => {
  // Check for Bun
  if (typeof Bun !== 'undefined') {
    return 'bun';
  }

  // Check for Deno
  if (typeof Deno !== 'undefined') {
    return 'deno';
  }

  // Check for Cloudflare Workers
  if (typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers') {
    return 'workerd';
  }

  // Check for Node.js
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    return 'node';
  }

  return 'unknown';
};

/**
 * HonoAdapter - Adapts Hono.js to work across multiple runtimes
 * Automatically detects the runtime and uses the appropriate server implementation
 */
export class HonoAdapter implements Adapter {
  name = 'hono';
  private runtime: ReturnType<typeof detectRuntime>;

  constructor(private hono: Hono) {
    this.runtime = detectRuntime();
  }

  /**
   * Start the server on the specified port
   * Automatically uses the appropriate server for the detected runtime
   */
  listen(port: number, callback?: () => void): ServerInstance {
    switch (this.runtime) {
      case 'bun':
        return this.listenBun(port, callback);
      
      case 'deno':
        return this.listenDeno(port, callback);
      
      case 'node':
        return this.listenNode(port, callback);
      
      case 'workerd':
        throw new Error(
          'Cloudflare Workers do not support listen(). Deploy using wrangler or export the handler with getHandler().'
        );
      
      default:
        throw new Error(
          `Unsupported runtime: ${this.runtime}. FastAPI-TS supports Bun, Node.js, Deno, and Cloudflare Workers.`
        );
    }
  }

  /**
   * Get the Hono fetch handler
   * This can be used directly in serverless environments or for custom server setups
   */
  getHandler() {
    return this.hono.fetch;
  }

  /**
   * Get the detected runtime
   */
  getRuntime(): string {
    return this.runtime;
  }

  /**
   * Start server using Bun's native server
   */
  private listenBun(port: number, callback?: () => void): ServerInstance {
    const server = Bun.serve({
      port,
      fetch: this.hono.fetch,
    });

    if (callback) {
      callback();
    }

    return {
      port,
      close: async () => {
        server.stop();
      },
      ...server
    };
  }

  /**
   * Start server using Deno's native server
   */
  private listenDeno(port: number, callback?: () => void): ServerInstance {
    // Deno.serve returns a promise, so we handle it appropriately
    const ac = new AbortController();
    
    Deno.serve(
      {
        port,
        signal: ac.signal,
        onListen: callback
      },
      this.hono.fetch
    );

    // Return an object with a close method for consistency
    return {
      port,
      close: async () => {
        ac.abort();
      },
    };
  }

  /**
   * Start server using Node.js adapter
   * Requires @hono/node-server package
   */
  private listenNode(port: number, callback?: () => void): ServerInstance {
    try {
      // Dynamically import @hono/node-server
      // This is a peer dependency that users need to install for Node.js support
      const { serve } = require('@hono/node-server');
      
      const server = serve(
        {
          fetch: this.hono.fetch,
          port,
        },
        callback
      );

      return {
        port,
        close: async () => {
          return new Promise<void>((resolve) => {
            server.close(() => resolve());
          });
        },
        ...server
      };
    } catch (error) {
      throw new Error(
        'Node.js adapter requires @hono/node-server package. Install it with: npm install @hono/node-server'
      );
    }
  }
}
