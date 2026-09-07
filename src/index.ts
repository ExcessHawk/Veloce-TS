/**
 * @module veloce-ts
 * @description Package entry point: exports the {@link VeloceTS} class, HTTP/DI decorators, validation,
 * errors, plugins, adapters and optional modules (auth, ORM, GraphQL, WebSocket, cache, testing).
 */
import 'reflect-metadata';

// Core exports
export { VeloceTS } from './core/application.js';
// Export Veloce as a shorter alias
export { VeloceTS as Veloce } from './core/application.js';
export { MetadataRegistry } from './core/metadata.js';
export { RouterCompiler } from './core/router-compiler.js';
export { MetadataCompiler, type CompiledRouteMetadata } from './core/compiled-metadata.js';

// Decorator exports
export * from './decorators/http.js';
export { Body, Param, Header, Cookie, Ctx, Query, Req, RequestId, AbortSignal } from './decorators/params.js';
export * from './decorators/dependencies.js';
export * from './decorators/middleware.js';
export * from './decorators/docs.js';
export * from './decorators/websocket.js';
export * from './decorators/graphql.js';
export { Cache, CacheInvalidate } from './decorators/cache.js';

// Validation exports
export { ValidationEngine } from './validation/validator.js';
export { ValidationException } from './validation/exceptions.js';

// Dependency Injection exports
export { DIContainer } from './dependencies/container.js';
export { registerDrizzle, InjectDB, DB_TOKEN } from './dependencies/drizzle.js';
export { registerPrisma, PRISMA_TOKEN } from './dependencies/prisma.js';
export { registerTypeORM, TYPEORM_TOKEN } from './dependencies/typeorm.js';

// Response exports.
//
// The response builder is exported as `VeloceResponse` (and the shorter `Res`).
// It used to be exported as `Response`, which shadowed the global Web API
// `Response` in any file that imported it — `new Response(body, init)` then
// silently resolved to this class instead. `Response` is still exported as a
// deprecated alias for backwards compatibility.
export {
  Response as VeloceResponse,
  Response as Res,
  /** @deprecated Shadows the global `Response`. Import `VeloceResponse` (or `Res`) instead. */
  Response,
  JSONResponse,
  HTMLResponse,
  RedirectResponse,
  FileResponse,
  StreamResponse,
  ResponseSerializer,
  type FileOptions,
  type StreamOptions,
} from './responses/response.js';

// Error exports (RFC 9457 + legacy; ver `VeloceTSConfig.errorResponseFormat`)
export * from './errors/exceptions.js';
export { ErrorHandler, type CustomErrorHandler, type ErrorHandlerOptions } from './errors/handler.js';
export {
  PROBLEM_JSON_MEDIA_TYPE,
  DEFAULT_PROBLEM_TYPE_BASE,
  problemTypeUri,
  resolveProblemType,
  resolveProblemTitle,
  buildProblemInstance,
  toLegacyErrorBody,
  sendErrorResponse,
  type ErrorResponseFormat,
} from './errors/problem-details.js';

// Middleware exports
export * from './middleware/index.js';

// Plugin exports
export type { Plugin } from './core/plugin.js';
export { PluginManager } from './core/plugin.js';
export * from './plugins/index.js';

// WebSocket exports
export * from './websocket/index.js';

// GraphQL exports
export * from './graphql/index.js';

// Documentation exports
export { OpenAPIGenerator } from './docs/openapi-generator.js';
export { ZodToJsonSchemaConverter, zodToJsonSchema } from './docs/zod-to-json-schema.js';

// Adapter exports
export * from './adapters/base.js';
export { HonoAdapter } from './adapters/hono.js';
export { ExpressAdapter } from './adapters/express.js';

// Type exports
export * from './types/index.js';

// Testing utilities exports
export * from './testing/index.js';

// Authentication exports
export * from './auth/exceptions.js';
export * from './auth/jwt-provider.js';
export * from './auth/auth-service.js';
export * from './auth/rbac.js';
export * from './auth/rbac-plugin.js';
export * from './auth/auth-plugin.js';
export * from './auth/decorators.js';
export * from './auth/rbac-decorators.js';
// OAuth exports (specific exports to avoid conflicts)
export type { OAuthProvider } from './auth/oauth-provider.js';
export { OAuthUserSchema } from './auth/oauth-provider.js';
export { OAuth, OAuthUser, OAuthToken, getOAuthUser, getOAuthToken, isOAuthAuthenticated, getOAuthProvider } from './auth/oauth-decorators.js';

// Auth plugin exports (OAuthPlugin, PermissionPlugin, SessionPlugin)
export { OAuthPlugin } from './auth/oauth-plugin.js';
export { PermissionPlugin } from './auth/permission-plugin.js';
export { SessionPlugin } from './auth/session-plugin.js';

// Session exports (specific exports to avoid conflicts)
export { SessionManager, SessionDataSchema } from './auth/session.js';
export type { SessionStore } from './auth/session.js';
export { Session, CurrentSession, CSRFToken, RequireCSRF, createSessionMiddleware, SessionGuard, getCurrentSession, getSessionManager, getCSRFProtection, getSessionData, isSessionAuthenticated, getSessionUserId, setSessionData, removeSessionData } from './auth/session-decorators.js';
export type { SessionData } from './auth/session-decorators.js';

// ORM and Transaction exports
export * from './orm/index.js';

// Logging exports
export * from './logging/index.js';

// Request Context exports
export * from './context/request-context.js';

// Cache exports
export * from './cache/index.js';

// Event bus exports
export { EventBus, globalEvents } from './events/index.js';

// Extra decorator exports
export {
  Throttle, getThrottle, type ThrottleOptions,
  ApiVersion, getApiVersion,
  ResponseHeader, getResponseHeaders,
  Redirect, getRedirect, type RedirectMeta,
} from './decorators/extras.js';

// Exception filter exports
export type { ExceptionFilter } from './errors/exception-filter.js';
export { Catch, FilterManager } from './errors/exception-filter.js';

// Interceptor exports
export type { Interceptor, ExecutionContext } from './core/interceptor-manager.js';
export { UseInterceptor, getInterceptors, InterceptorManager } from './core/interceptor-manager.js';

// Streaming decorator exports
export { SSE, Stream, isSSE, getStreamContentType } from './decorators/stream.js';
