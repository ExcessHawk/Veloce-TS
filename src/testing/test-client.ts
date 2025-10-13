import type { FastAPITS } from '../core/application';
import type { Hono } from 'hono';

/**
 * Options for making test requests
 */
export interface TestRequestOptions {
  headers?: Record<string, string>;
  query?: Record<string, string>;
  body?: any;
  json?: any;
}

/**
 * Response from a test request
 */
export interface TestResponse {
  status: number;
  headers: Headers;
  body: any;
  text: string;
  json: () => Promise<any>;
  ok: boolean;
}

/**
 * TestClient provides a convenient interface for testing FastAPITS applications
 * Wraps the Hono app.request method with helper methods for common HTTP verbs
 */
export class TestClient {
  private hono: Hono;

  constructor(app: FastAPITS) {
    this.hono = app.getHono();
  }

  /**
   * Make a GET request
   * @param path - The path to request
   * @param options - Optional request options
   * @returns The test response
   */
  async get(path: string, options?: TestRequestOptions): Promise<TestResponse> {
    return this.request('GET', path, options);
  }

  /**
   * Make a POST request
   * @param path - The path to request
   * @param options - Optional request options
   * @returns The test response
   */
  async post(path: string, options?: TestRequestOptions): Promise<TestResponse> {
    return this.request('POST', path, options);
  }

  /**
   * Make a PUT request
   * @param path - The path to request
   * @param options - Optional request options
   * @returns The test response
   */
  async put(path: string, options?: TestRequestOptions): Promise<TestResponse> {
    return this.request('PUT', path, options);
  }

  /**
   * Make a DELETE request
   * @param path - The path to request
   * @param options - Optional request options
   * @returns The test response
   */
  async delete(path: string, options?: TestRequestOptions): Promise<TestResponse> {
    return this.request('DELETE', path, options);
  }

  /**
   * Make a PATCH request
   * @param path - The path to request
   * @param options - Optional request options
   * @returns The test response
   */
  async patch(path: string, options?: TestRequestOptions): Promise<TestResponse> {
    return this.request('PATCH', path, options);
  }

  /**
   * Make a generic HTTP request
   * @param method - The HTTP method
   * @param path - The path to request
   * @param options - Optional request options
   * @returns The test response
   */
  async request(
    method: string,
    path: string,
    options?: TestRequestOptions
  ): Promise<TestResponse> {
    // Build URL with query parameters
    const url = this.buildUrl(path, options?.query);

    // Build request init
    const init: RequestInit = {
      method,
      headers: this.buildHeaders(options),
    };

    // Add body if present
    if (options?.body !== undefined) {
      init.body = options.body;
    } else if (options?.json !== undefined) {
      init.body = JSON.stringify(options.json);
    }

    // Make the request using Hono's request method
    const response = await this.hono.request(url, init);

    // Parse response
    const text = await response.text();
    let body: any;

    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }

    return {
      status: response.status,
      headers: response.headers,
      body,
      text,
      json: async () => JSON.parse(text),
      ok: response.ok,
    };
  }

  /**
   * Build URL with query parameters
   * @param path - The base path
   * @param query - Optional query parameters
   * @returns The complete URL
   */
  private buildUrl(path: string, query?: Record<string, string>): string {
    if (!query || Object.keys(query).length === 0) {
      return path;
    }

    const queryString = new URLSearchParams(query).toString();
    return `${path}?${queryString}`;
  }

  /**
   * Build headers for the request
   * @param options - Request options
   * @returns Headers object
   */
  private buildHeaders(options?: TestRequestOptions): Record<string, string> {
    const headers: Record<string, string> = {
      ...options?.headers,
    };

    // Add Content-Type for JSON requests
    if (options?.json !== undefined && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    return headers;
  }
}
