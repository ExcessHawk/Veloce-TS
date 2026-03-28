/**
 * @module veloce-ts/testing/test-client
 * @description Cliente HTTP de pruebas sobre `app.getHono().request()` con aserciones encadenables (`expectStatus`, `expectJson`, …).
 */
import type { VeloceTS } from '../core/application';
import type { Hono } from 'hono';

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

/**
 * Options for making a single test request.
 */
export interface TestRequestOptions {
  headers?: Record<string, string>;
  query?: Record<string, string>;
  body?: any;
  json?: any;
}

/**
 * Rich response wrapper returned by every TestClient request.
 * All assertion methods return `this` so they can be chained.
 */
export class TestResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly body: any;
  readonly text: string;
  readonly ok: boolean;

  constructor(data: {
    status: number;
    headers: Headers;
    body: any;
    text: string;
    ok: boolean;
  }) {
    this.status = data.status;
    this.headers = data.headers;
    this.body = data.body;
    this.text = data.text;
    this.ok = data.ok;
  }

  /** Parse body as JSON (async – kept for backwards compat). */
  async json<T = any>(): Promise<T> {
    return JSON.parse(this.text) as T;
  }

  // -------------------------------------------------------------------------
  // Assertion helpers
  // -------------------------------------------------------------------------

  /**
   * Assert HTTP status code.
   * @throws Error if status doesn't match.
   */
  expectStatus(code: number): this {
    if (this.status !== code) {
      throw new Error(
        `Expected HTTP ${code} but got ${this.status}.\nBody: ${this.text}`
      );
    }
    return this;
  }

  /**
   * Assert that the response body is a JSON object and contains at least
   * the provided key-value pairs (deep partial match).
   * @throws Error on mismatch.
   */
  expectJson(expected: Record<string, any>): this {
    const body = this.body;
    if (typeof body !== 'object' || body === null) {
      throw new Error(`Expected JSON body but got: ${this.text}`);
    }
    for (const [key, value] of Object.entries(expected)) {
      const actual = (body as any)[key];
      const match =
        typeof value === 'object' && value !== null
          ? JSON.stringify(actual) === JSON.stringify(value)
          : actual === value;
      if (!match) {
        throw new Error(
          `Expected body.${key} = ${JSON.stringify(value)}, got ${JSON.stringify(actual)}.\nFull body: ${this.text}`
        );
      }
    }
    return this;
  }

  /**
   * Assert that the body contains a specific field (optionally with a value).
   */
  expectField(field: string, value?: any): this {
    const body = this.body;
    if (typeof body !== 'object' || body === null || !(field in body)) {
      throw new Error(`Expected field "${field}" in body.\nBody: ${this.text}`);
    }
    if (value !== undefined) {
      const actual = (body as any)[field];
      if (actual !== value) {
        throw new Error(
          `Expected body.${field} = ${JSON.stringify(value)}, got ${JSON.stringify(actual)}`
        );
      }
    }
    return this;
  }

  /**
   * Assert that response header exists (and optionally equals value).
   */
  expectHeader(name: string, value?: string): this {
    const actual = this.headers.get(name);
    if (actual === null) {
      throw new Error(`Expected response header "${name}" to be present`);
    }
    if (value !== undefined && actual !== value) {
      throw new Error(
        `Expected header "${name}" = "${value}", got "${actual}"`
      );
    }
    return this;
  }

  /**
   * Assert that the body array has exactly the given length.
   */
  expectArrayLength(length: number): this {
    if (!Array.isArray(this.body)) {
      throw new Error(`Expected array body but got: ${typeof this.body}`);
    }
    if (this.body.length !== length) {
      throw new Error(
        `Expected array length ${length} but got ${this.body.length}`
      );
    }
    return this;
  }

  /** Convenience: assert status 200. */
  expectOk(): this { return this.expectStatus(200); }

  /** Convenience: assert status 201. */
  expectCreated(): this { return this.expectStatus(201); }

  /** Convenience: assert status 204. */
  expectNoContent(): this { return this.expectStatus(204); }

  /** Convenience: assert status 400. */
  expectBadRequest(): this { return this.expectStatus(400); }

  /** Convenience: assert status 401. */
  expectUnauthorized(): this { return this.expectStatus(401); }

  /** Convenience: assert status 403. */
  expectForbidden(): this { return this.expectStatus(403); }

  /** Convenience: assert status 404. */
  expectNotFound(): this { return this.expectStatus(404); }

  /** Convenience: assert status 422. */
  expectUnprocessable(): this { return this.expectStatus(422); }
}

// ---------------------------------------------------------------------------
// TestClient
// ---------------------------------------------------------------------------

/**
 * TestClient provides a fluent interface for testing VeloceTS applications.
 *
 * Basic usage:
 * ```ts
 * const client = new TestClient(app);
 * const res = await client.get('/users');
 * res.expectStatus(200).expectField('users');
 * ```
 *
 * With persistent auth token:
 * ```ts
 * const token = await client.loginAs({ username: 'alice', password: 'secret' });
 * const res = await client.get('/protected');
 * ```
 */
export class TestClient {
  private hono: Hono;
  private defaultHeaders: Record<string, string> = {};

  constructor(app: VeloceTS) {
    this.hono = app.getHono();
  }

  // -------------------------------------------------------------------------
  // Configuration helpers (fluent, return new instance to stay immutable)
  // -------------------------------------------------------------------------

  /**
   * Return a new TestClient that includes a Bearer token in every request.
   * The original client is not modified.
   */
  withToken(token: string): TestClient {
    const clone = this._clone();
    clone.defaultHeaders['Authorization'] = `Bearer ${token}`;
    return clone;
  }

  /**
   * Return a new TestClient with additional persistent headers.
   */
  withHeaders(headers: Record<string, string>): TestClient {
    const clone = this._clone();
    clone.defaultHeaders = { ...clone.defaultHeaders, ...headers };
    return clone;
  }

  // -------------------------------------------------------------------------
  // Auth shortcuts
  // -------------------------------------------------------------------------

  /**
   * POST to a login endpoint and return the access token.
   * Also configures this client instance to send that token automatically
   * on all subsequent requests.
   *
   * @param credentials - Username/password or email/password
   * @param endpoint    - Login path (defaults to '/auth/login')
   * @returns The JWT access token string
   * @throws If the login request fails
   *
   * @example
   * ```ts
   * const client = new TestClient(app);
   * const token = await client.loginAs({ username: 'alice', password: 'secret' });
   * // From here client sends Authorization: Bearer <token> automatically
   * const res = await client.get('/profile');
   * ```
   */
  async loginAs(
    credentials: { username?: string; email?: string; password: string },
    endpoint = '/auth/login'
  ): Promise<string> {
    const res = await this.post(endpoint, { json: credentials });
    if (res.status >= 400) {
      throw new Error(
        `loginAs failed — server returned HTTP ${res.status}.\nBody: ${res.text}`
      );
    }

    // Support both { token } and { tokens: { accessToken } } shapes
    const body = res.body as any;
    const token: string =
      body?.tokens?.accessToken ?? body?.accessToken ?? body?.token ?? '';

    if (!token) {
      throw new Error(
        `loginAs: could not extract token from response.\nBody: ${res.text}`
      );
    }

    // Mutate this instance so all further requests carry the token
    this.defaultHeaders['Authorization'] = `Bearer ${token}`;
    return token;
  }

  /**
   * POST to a register endpoint and then immediately log in.
   * Returns the JWT access token.
   *
   * @param user         - User data for registration
   * @param endpoints    - Custom register / login paths
   */
  async registerAndLogin(
    user: { username?: string; email?: string; password: string; [key: string]: any },
    endpoints: { register?: string; login?: string } = {}
  ): Promise<string> {
    const registerPath = endpoints.register ?? '/auth/register';
    const loginPath    = endpoints.login    ?? '/auth/login';

    const regRes = await this.post(registerPath, { json: user });
    if (regRes.status >= 400 && regRes.status !== 409) {
      throw new Error(
        `registerAndLogin: registration failed — HTTP ${regRes.status}.\nBody: ${regRes.text}`
      );
    }

    const loginCredentials: any = {};
    if (user.username) loginCredentials.username = user.username;
    if (user.email)    loginCredentials.email    = user.email;
    loginCredentials.password = user.password;

    return this.loginAs(loginCredentials, loginPath);
  }

  /**
   * Clear the stored auth token (if you want to test un-authenticated requests
   * after a loginAs call).
   */
  clearAuth(): this {
    delete this.defaultHeaders['Authorization'];
    return this;
  }

  // -------------------------------------------------------------------------
  // HTTP verbs
  // -------------------------------------------------------------------------

  async get(path: string, options?: TestRequestOptions): Promise<TestResponse> {
    return this.request('GET', path, options);
  }

  async post(path: string, options?: TestRequestOptions): Promise<TestResponse> {
    return this.request('POST', path, options);
  }

  async put(path: string, options?: TestRequestOptions): Promise<TestResponse> {
    return this.request('PUT', path, options);
  }

  async patch(path: string, options?: TestRequestOptions): Promise<TestResponse> {
    return this.request('PATCH', path, options);
  }

  async delete(path: string, options?: TestRequestOptions): Promise<TestResponse> {
    return this.request('DELETE', path, options);
  }

  // -------------------------------------------------------------------------
  // Core request method
  // -------------------------------------------------------------------------

  async request(
    method: string,
    path: string,
    options?: TestRequestOptions
  ): Promise<TestResponse> {
    const url = this._buildUrl(path, options?.query);

    const init: RequestInit = {
      method,
      headers: this._buildHeaders(options),
    };

    if (options?.body !== undefined) {
      init.body = options.body;
    } else if (options?.json !== undefined) {
      init.body = JSON.stringify(options.json);
    }

    const response = await this.hono.request(url, init);
    const text = await response.text();

    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }

    return new TestResponse({
      status: response.status,
      headers: response.headers,
      body,
      text,
      ok: response.ok,
    });
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private _buildUrl(path: string, query?: Record<string, string>): string {
    if (!query || Object.keys(query).length === 0) return path;
    return `${path}?${new URLSearchParams(query).toString()}`;
  }

  private _buildHeaders(options?: TestRequestOptions): Record<string, string> {
    const headers: Record<string, string> = {
      ...this.defaultHeaders,
      ...options?.headers,
    };
    if (options?.json !== undefined && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    return headers;
  }

  private _clone(): TestClient {
    const clone = Object.create(TestClient.prototype) as TestClient;
    clone.hono = this.hono;
    clone.defaultHeaders = { ...this.defaultHeaders };
    return clone;
  }
}
