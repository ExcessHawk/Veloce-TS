/**
 * Express adapter for FastAPI-TS
 * Bridges FastAPI-TS routes to Express.js framework
 * Allows integration with existing Express applications
 */
import type { Adapter } from './base';
import type { VeloceTS } from '../core/application';

// Type declarations for Express (peer dependency)
declare const require: any;

/**
 * ExpressAdapter - Bridges FastAPI-TS to Express.js
 * Converts Express req/res to Hono Context format
 */
export class ExpressAdapter implements Adapter {
  name = 'express';
  private express: any;

  constructor(private app: VeloceTS) {
    try {
      // Express is a peer dependency
      const expressModule = require('express');
      this.express = expressModule();
      this.setupBridge();
    } catch (error) {
      throw new Error(
        'Express adapter requires express package. Install it with: npm install express'
      );
    }
  }

  /**
   * Set up the bridge between FastAPI-TS and Express
   * Converts all FastAPI-TS routes to Express routes
   */
  private setupBridge(): void {
    // Get the Hono instance from FastAPI-TS
    const hono = this.app.getHono();

    // Use Express middleware to forward all requests to Hono
    this.express.use(async (req: any, res: any) => {
      try {
        // Convert Express request to Web Standard Request
        const request = this.createWebRequest(req);

        // Call Hono's fetch handler
        const response = await hono.fetch(request);

        // Convert Web Standard Response to Express response
        await this.sendExpressResponse(res, response);
      } catch (error) {
        // Handle errors
        res.status(500).json({
          error: 'Internal Server Error',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });
  }

  /**
   * Convert Express request to Web Standard Request
   */
  private createWebRequest(req: any): Request {
    // Build the full URL
    const protocol = req.protocol || 'http';
    const host = req.get('host') || 'localhost';
    const url = `${protocol}://${host}${req.originalUrl || req.url}`;

    // Build headers
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') {
        headers.set(key, value);
      } else if (Array.isArray(value)) {
        value.forEach(v => headers.append(key, v));
      }
    }

    // Build request options
    const options: RequestInit = {
      method: req.method,
      headers,
    };

    // Add body for methods that support it
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      // Express body-parser middleware should have already parsed the body
      if (req.body) {
        options.body = JSON.stringify(req.body);
        headers.set('content-type', 'application/json');
      }
    }

    return new Request(url, options);
  }

  /**
   * Convert Web Standard Response to Express response
   */
  private async sendExpressResponse(res: any, response: Response): Promise<void> {
    // Set status code
    res.status(response.status);

    // Set headers
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    // Send body
    if (response.body) {
      // Check content type to determine how to send the response
      const contentType = response.headers.get('content-type') || '';

      if (contentType.includes('application/json')) {
        const json = await response.json();
        res.json(json);
      } else if (contentType.includes('text/')) {
        const text = await response.text();
        res.send(text);
      } else {
        // For binary data, stream it
        const buffer = await response.arrayBuffer();
        res.send(Buffer.from(buffer));
      }
    } else {
      res.end();
    }
  }

  /**
   * Start the Express server on the specified port
   */
  listen(port: number, callback?: () => void): any {
    return this.express.listen(port, callback);
  }

  /**
   * Get the Express app instance
   * This allows users to add additional Express middleware or routes
   */
  getHandler(): any {
    return this.express;
  }

  /**
   * Get the underlying Express app for advanced customization
   */
  getExpressApp(): any {
    return this.express;
  }
}
