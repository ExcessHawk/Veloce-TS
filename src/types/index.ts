/**
 * @module veloce-ts/types
 * @description Shared types: `Context`, route metadata, application config (`VeloceTSConfig`),
 * CORS/rate-limit options, auth/session contracts, and a re-export of `z` (Zod).
 */
import type { Context as HonoContext, Hono, MiddlewareHandler } from 'hono';
import type { ZodSchema, z } from 'zod';
import type { Plugin } from '../core/plugin.js';
import type { CacheStore } from '../cache/types.js';

// Re-export Zod's infer helper for user convenience
export { z } from 'zod';
export type { infer as Infer } from 'zod';

// HTTP Methods
export type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS' | 'ALL';

// Class type
export type Class<T = any> = new (...args: any[]) => T;

// Provider types
export type Provider<T = any> = Class<T> | (() => T | Promise<T>) | string | symbol;
export type Scope = 'singleton' | 'request' | 'transient';

// Context type (re-export from Hono)
export type Context = HonoContext;

/**
 * Typed context variables.
 *
 * Augmenting Hono's `ContextVariableMap` means `c.get('auth.user')` returns the
 * declared type instead of `any`, and a typo in the key is a compile error.
 * Applications can add their own keys with the same declaration merging.
 */
declare module 'hono' {
  interface ContextVariableMap {
    /** Payload of the verified access token, set by the auth middleware. */
    'auth.user': import('../auth/jwt-provider.js').TokenPayload | null;
    /** Raw bearer token as presented by the client. */
    'auth.token': string | null;
    /** Why authentication failed, when it did. */
    'auth.error': string;
    /** Whether the request carries valid credentials. */
    'auth.authenticated': boolean;
    /** The AuthService instance, exposed by AuthPlugin. */
    'authService': import('../auth/auth-service.js').AuthService;
    /** Current session, set by the session middleware. */
    'session': import('../auth/session.js').SessionData | null;
    /** SessionManager instance, exposed by SessionPlugin. */
    'sessionManager': import('../auth/session.js').SessionManager | null;
    /** CSRFProtection instance, when CSRF is enabled. */
    'csrfProtection': import('../auth/session.js').CSRFProtection | undefined;
    /** CSRF token for the current session. */
    'csrf.token': string | null;
    /** PermissionManager instance, exposed by PermissionPlugin. */
    'permissionManager': import('../auth/permissions.js').PermissionManager | null;
    /** RBACManager instance, exposed by RBACPlugin. */
    'rbacManager': import('../auth/rbac.js').RBACManager | null;
    /** OAuth profile / token, set by the OAuth middleware. */
    'oauth.user': import('../auth/oauth-provider.js').OAuthUser | null;
    'oauth.token': import('../auth/oauth-provider.js').OAuthTokens | null;
    /** Resource and attribute set filtered by the permission middleware. */
    'filtered.resource': unknown;
    'filtered.attributes': string[];
    /** Compiled metadata for the route currently executing. */
    'routeMetadata': import('../core/compiled-metadata.js').CompiledRouteMetadata | null;
    /** CORS headers captured for the current request. */
    'veloce:corsHeaders': Record<string, string>;
  }
}

// Middleware type
export type Middleware = MiddlewareHandler;

// Route metadata
export interface RouteMetadata {
  target: Class;
  propertyKey: string;
  method: HTTPMethod;
  path: string;
  middleware: Middleware[];
  parameters: ParameterMetadata[];
  dependencies: DependencyMetadata[];
  responses: ResponseMetadata[];
  docs?: RouteDocumentation;
  /** Override the HTTP status code returned by this route (e.g. 201 for creation) */
  statusCode?: number;
  /** Zod schema used to validate / strip the handler's return value */
  responseSchema?: ZodSchema;
  auth?: AuthMetadata;
  oauth?: OAuthMetadata;
  roles?: RoleMetadata;
  permissions?: PermissionMetadata;
  minimumRole?: MinimumRoleMetadata;
  resourcePermission?: ResourcePermissionMetadata;
  session?: SessionMetadata;
  csrf?: CSRFMetadata;
  cache?: CacheMetadata;
  cacheInvalidate?: string[];
}

// Cache metadata
export interface CacheMetadata {
  ttl: number | string;
  key?: string;
  prefix?: string;
  includeQuery?: boolean;
  /**
   * Request headers the cache key varies by (e.g. `['authorization']`).
   * Required for any cached route whose response depends on the caller —
   * without it, one user's response is served to the next.
   */
  varyByHeaders?: string[];
  /** Build the cache key from the request (replaces the default scheme). */
  keyGenerator?: (c: Context) => string;
  condition?: (result: any) => boolean;
  store?: CacheStore;
}

// Parameter metadata
export interface ParameterMetadata {
  index: number;
  type: 'body' | 'query' | 'param' | 'header' | 'cookie' | 'request' | 'response' | 'context' | 'current-user' | 'token' | 'oauth-user' | 'oauth-token' | 'filtered-resource' | 'filtered-attributes' | 'current-session' | 'session-data' | 'csrf-token' | 'request-id' | 'abort-signal';
  schema?: ZodSchema;
  name?: string;
  required: boolean;
  /** Extra per-parameter-type data: `action` for `@CanAccess`-style checks, `key` for `@SessionData`. */
  metadata?: { action?: string; key?: string };
}

// Dependency metadata
export interface DependencyMetadata {
  index: number;
  provider: Provider;
  scope: Scope;
}

// Response metadata
export interface ResponseMetadata {
  statusCode: number;
  description?: string;
  schema?: ZodSchema;
}

// Controller metadata
export interface ControllerMetadata {
  prefix: string;
  middleware: Middleware[];
  /** Instantiation scope for the controller class. Defaults to 'singleton'.
   *  Use 'request' or 'transient' when the controller keeps per-request state
   *  or injects request-scoped dependencies in its constructor. */
  scope?: 'singleton' | 'request' | 'transient';
}

// Route documentation
export interface RouteDocumentation {
  summary?: string;
  description?: string;
  tags?: string[];
  deprecated?: boolean;
  /** Media type of the request body (default: 'application/json'), e.g. 'multipart/form-data' */
  requestContentType?: string;
  /** Explicit OpenAPI component-schema name for the request body schema */
  bodySchemaName?: string;
  /** Request/response examples emitted into the generated OpenAPI media types */
  examples?: {
    /** Single request body example (emitted as media-type `example`) */
    request?: any;
    /** Named request body examples (emitted as media-type `examples`) */
    namedRequest?: Record<string, { summary?: string; description?: string; value: any }>;
    /** Response example per HTTP status code, e.g. { 200: {...} } (emitted as media-type `example`) */
    responses?: Record<string | number, any>;
  };
}

// Configuration types
export interface VeloceTSConfig {
  adapter?: 'hono' | 'express' | 'native';
  title?: string;
  version?: string;
  description?: string;
  /**
   * Mount OpenAPI docs. `true` (default) serves the spec at `/openapi.json`
   * and Swagger UI at `/docs`; pass an object to change those paths, or
   * `false` to disable. Ignored when an `openapi` plugin is registered manually.
   */
  docs?: boolean | { path?: string; openapi?: string };
  cors?: CorsOptions | boolean;
  /** Plugins to register at construction time (same as calling `usePlugin`). */
  plugins?: Plugin[];
  /**
   * Maximum request body size in bytes. Bodies above it are rejected with 413
   * before any handler runs. Defaults to 1 MiB; `0` disables the limit.
   */
  bodyLimit?: number;
  /**
   * Formato de respuestas de error del framework.
   * - `rfc9457` — Problem Details (`application/problem+json`).
   * - `legacy` — `{ error, statusCode, details? }` como en versiones anteriores a 0.5.
   * @default 'rfc9457'
   */
  errorResponseFormat?: 'rfc9457' | 'legacy';
}

export interface CorsOptions {
  origin?: string | string[] | ((origin: string) => boolean);
  methods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;
}

/** One counter bucket returned by a {@link RateLimitStore}. */
export interface RateLimitHit {
  /** Requests seen for this key in the current window, including this one. */
  count: number;
  /** Epoch milliseconds at which the current window ends. */
  resetTime: number;
}

/**
 * Backing store for rate-limit counters. The default store is in-memory
 * (per-process); supply a shared implementation (e.g. Redis) to enforce one
 * limit across several instances.
 */
export interface RateLimitStore {
  /** Record a request for `key` and return the resulting bucket. */
  hit(key: string, windowMs: number): Promise<RateLimitHit>;
  /** Drop the counter for `key`. */
  reset(key: string): Promise<void>;
}

export interface RateLimitOptions {
  windowMs?: number;
  max?: number;
  keyGenerator?: (c: Context) => string;
  /** Counter backend. Defaults to an in-memory, per-process store. */
  store?: RateLimitStore;
  /**
   * Trust X-Forwarded-For / X-Real-IP headers for client identification.
   * Leave false (default) unless the app runs behind a trusted reverse proxy —
   * these headers are client-supplied and trivially spoofable otherwise.
   * @default false
   */
  trustProxy?: boolean;
}

export interface CompressionOptions {
  threshold?: number;
  level?: number;
}

// Schema bag for the functional API
export interface RouteSchemas {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
  headers?: ZodSchema;
}

/**
 * Handler argument tuple inferred from the declared schemas, in the fixed
 * order the framework injects them: body, query, params, headers.
 * Only declared schemas contribute an argument.
 */
export type SchemaArgs<S extends RouteSchemas | undefined> = S extends RouteSchemas
  ? [
      ...(S['body'] extends ZodSchema ? [z.output<S['body']>] : []),
      ...(S['query'] extends ZodSchema ? [z.output<S['query']>] : []),
      ...(S['params'] extends ZodSchema ? [z.output<S['params']>] : []),
      ...(S['headers'] extends ZodSchema ? [z.output<S['headers']>] : []),
    ]
  : [];

/**
 * Route config for the functional API. Generic over the schema bag so the
 * handler's extra arguments are typed end-to-end from the Zod schemas:
 *
 * ```ts
 * app.post('/users', {
 *   schema: { body: CreateUserSchema },
 *   handler: async (c, body) => body.name, // body: z.output<typeof CreateUserSchema>
 * });
 * ```
 */
export interface RouteConfig<S extends RouteSchemas = RouteSchemas> {
  handler: (c: Context, ...args: SchemaArgs<S>) => any | Promise<any>;
  schema?: S;
  middleware?: Middleware[];
  docs?: RouteDocumentation;
  responses?: ResponseMetadata[];
  cache?: CacheMetadata;
  timeout?: number;
}

// Provider config
export interface ProviderConfig {
  scope?: Scope;
  factory?: () => any;
}

// OpenAPI types
export interface OpenAPIOptions {
  title?: string;
  version?: string;
  description?: string;
  path?: string;
  docsPath?: string;
  docs?: boolean;
}

export interface OpenAPISpec {
  openapi: string;
  /** OpenAPI 3.1: JSON Schema dialect URI */
  jsonSchemaDialect?: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  paths: Record<string, any>;
  components?: {
    schemas?: Record<string, any>;
    securitySchemes?: Record<string, any>;
  };
  /** Top-level tag definitions (auto-populated from route path prefixes) */
  tags?: Array<{ name: string; description?: string }>;
}

// WebSocket types
export interface WebSocketMetadata {
  target: Class;
  path: string;
  onConnect?: string;
  onMessage?: string;
  onDisconnect?: string;
  messageSchema?: ZodSchema;
  /** Resolved DI instance — populated by WebSocketPlugin.install() */
  instance?: any;
}

export interface WebSocketHandlerMetadata {
  type: 'connect' | 'message' | 'disconnect';
  method: string;
  schema?: ZodSchema;
}

// GraphQL types
export type GraphQLOperationType = 'query' | 'mutation' | 'subscription';

export interface GraphQLResolverMetadata {
  target: Class;
  name?: string;
}

export interface GraphQLFieldMetadata {
  target: Class;
  propertyKey: string;
  type: GraphQLOperationType;
  name?: string;
  returnType?: any;
  description?: string;
  deprecated?: boolean;
  deprecationReason?: string;
}

export interface GraphQLArgumentMetadata {
  index: number;
  name: string;
  schema?: ZodSchema;
  description?: string;
  defaultValue?: any;
  nullable?: boolean;
}

export interface GraphQLContextMetadata {
  index: number;
}

// Authentication types
export interface AuthMetadata {
  required: boolean;
  config?: AuthConfig;
}

export interface AuthConfig {
  optional?: boolean;
  roles?: string[];
  permissions?: string[];
  scopes?: string[];
}

// OAuth types
export interface OAuthMetadata {
  provider: string;
  config?: OAuthConfig;
}

export interface OAuthConfig {
  provider: string;
  scopes?: string[];
  optional?: boolean;
}

// RBAC types
export interface RoleMetadata {
  config: RolesConfig;
}

export interface PermissionMetadata {
  config: PermissionsConfig;
}

export interface MinimumRoleMetadata {
  roleName: string;
}

export interface RolesConfig {
  roles: string[];
  requireAll?: boolean;
  allowInherited?: boolean;
}

export interface PermissionsConfig {
  permissions: string[];
  requireAll?: boolean;
}

// Resource permission types
export interface ResourcePermissionMetadata {
  config: ResourcePermissionConfig;
}

export interface ResourcePermissionConfig {
  action: string;
  resource?: string;
  attributes?: string[];
  conditions?: Array<{
    field: string;
    operator: string;
    value: any;
  }>;
}

// Session types
export interface SessionMetadata {
  config: SessionConfig;
}

export interface CSRFMetadata {
  required: boolean;
}

export interface SessionConfig {
  required?: boolean;
  regenerate?: boolean;
  csrf?: boolean;
}

// ============================================================================
// Type Inference Helpers
// ============================================================================

/**
 * Infer TypeScript type from a Zod schema
 * @example
 * const UserSchema = z.object({ name: z.string(), age: z.number() });
 * type User = InferSchema<typeof UserSchema>; // { name: string; age: number }
 */
export type InferSchema<T extends ZodSchema> = z.infer<T>;

/**
 * Infer the body type from a route handler
 * @example
 * const handler = (body: InferBody<typeof UserSchema>) => { ... }
 */
export type InferBody<T extends ZodSchema> = z.infer<T>;

/**
 * Infer the query parameters type from a route handler
 * @example
 * const handler = (query: InferQuery<typeof QuerySchema>) => { ... }
 */
export type InferQuery<T extends ZodSchema> = z.infer<T>;

/**
 * Infer the route parameters type from a route handler
 * @example
 * const handler = (params: InferParams<typeof ParamsSchema>) => { ... }
 */
export type InferParams<T extends ZodSchema> = z.infer<T>;

/**
 * Infer the headers type from a route handler
 * @example
 * const handler = (headers: InferHeaders<typeof HeadersSchema>) => { ... }
 */
export type InferHeaders<T extends ZodSchema> = z.infer<T>;

/**
 * Extract the return type of a handler function
 * @example
 * const handler = async () => ({ id: 1, name: 'John' });
 * type Response = InferResponse<typeof handler>; // { id: number; name: string }
 */
export type InferResponse<T extends (...args: any[]) => any> = 
  Awaited<ReturnType<T>>;

/**
 * Extract the dependency type from a provider
 * @example
 * class UserService { ... }
 * type Service = InferDependency<typeof UserService>; // UserService
 */
export type InferDependency<T extends Provider> = 
  T extends Class<infer R> ? R : 
  T extends () => infer R ? R :
  T extends () => Promise<infer R> ? R :
  never;

/**
 * Type-safe route handler with inferred parameter types
 * @example
 * const handler: TypedHandler<typeof BodySchema, typeof QuerySchema> = 
 *   async (body, query) => { ... }
 */
export type TypedHandler<
  TBody extends ZodSchema = any,
  TQuery extends ZodSchema = any,
  TParams extends ZodSchema = any,
  TResponse = any
> = (
  body?: z.infer<TBody>,
  query?: z.infer<TQuery>,
  params?: z.infer<TParams>,
  context?: Context
) => TResponse | Promise<TResponse>;

/**
 * Utility type to make all properties of T optional recursively
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/**
 * Utility type to make all properties of T required recursively
 */
export type DeepRequired<T> = {
  [P in keyof T]-?: T[P] extends object ? DeepRequired<T[P]> : T[P];
};

/**
 * Extract keys from T that are of type U
 */
export type KeysOfType<T, U> = {
  [K in keyof T]: T[K] extends U ? K : never;
}[keyof T];

/**
 * Make specific keys K of T optional
 */
export type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

/**
 * Make specific keys K of T required
 */
export type RequiredBy<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>;
