// Type definitions for Veloce-TS
import type { Context as HonoContext, Hono, MiddlewareHandler } from 'hono';
import type { ZodSchema, z } from 'zod';

// Re-export Zod's infer helper for user convenience
export { z } from 'zod';
export type { infer as Infer } from 'zod';

// HTTP Methods
export type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS' | 'ALL';

// Class type
export type Class<T = any> = new (...args: any[]) => T;

// Provider types
export type Provider<T = any> = Class<T> | (() => T | Promise<T>);
export type Scope = 'singleton' | 'request' | 'transient';

// Context type (re-export from Hono)
export type Context = HonoContext;

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
}

// Parameter metadata
export interface ParameterMetadata {
  index: number;
  type: 'body' | 'query' | 'param' | 'header' | 'cookie' | 'request' | 'response' | 'context';
  schema?: ZodSchema;
  name?: string;
  required: boolean;
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
}

// Route documentation
export interface RouteDocumentation {
  summary?: string;
  description?: string;
  tags?: string[];
  deprecated?: boolean;
}

// Configuration types
export interface VeloceTSConfig {
  adapter?: 'hono' | 'express' | 'native';
  title?: string;
  version?: string;
  description?: string;
  docs?: boolean | { path?: string; openapi?: string };
  cors?: CorsOptions | boolean;
  plugins?: any[];
}

export interface CorsOptions {
  origin?: string | string[] | ((origin: string) => boolean);
  methods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;
}

export interface RateLimitOptions {
  windowMs?: number;
  max?: number;
  keyGenerator?: (c: Context) => string;
}

export interface CompressionOptions {
  threshold?: number;
  level?: number;
}

// Route config for functional API
export interface RouteConfig {
  handler: (c: Context, ...args: any[]) => any | Promise<any>;
  schema?: {
    body?: ZodSchema;
    query?: ZodSchema;
    params?: ZodSchema;
    headers?: ZodSchema;
  };
  middleware?: Middleware[];
  docs?: RouteDocumentation;
  responses?: ResponseMetadata[];
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
}

// WebSocket types
export interface WebSocketMetadata {
  target: Class;
  path: string;
  onConnect?: string;
  onMessage?: string;
  onDisconnect?: string;
  messageSchema?: ZodSchema;
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
