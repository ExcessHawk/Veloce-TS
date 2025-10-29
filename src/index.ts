// VeloceTS - Main entry point
import 'reflect-metadata';

// Core exports
export { VeloceTS } from './core/application';
// Export Veloce as a shorter alias
export { VeloceTS as Veloce } from './core/application';
// Keep FastAPITS as an alias for compatibility
export { VeloceTS as FastAPITS } from './core/application';
export { MetadataRegistry } from './core/metadata';
export { RouterCompiler } from './core/router-compiler';
export { MetadataCompiler, type CompiledRouteMetadata } from './core/compiled-metadata';

// Decorator exports
export * from './decorators/http';
export { Body, Param, Header, Cookie, Ctx, Query, RequestId, AbortSignal } from './decorators/params';
export * from './decorators/dependencies';
export * from './decorators/middleware';
export * from './decorators/docs';
export * from './decorators/websocket';
export * from './decorators/graphql';
export { Cache, CacheInvalidate } from './decorators/cache';

// Validation exports
export { ValidationEngine } from './validation/validator';
export { ValidationException } from './validation/exceptions';

// Dependency Injection exports
export { DIContainer } from './dependencies/container';

// Response exports
export * from './responses/response';

// Error exports
export * from './errors/exceptions';
export { ErrorHandler } from './errors/handler';

// Middleware exports
export * from './middleware';

// Plugin exports
export type { Plugin } from './core/plugin';
export { PluginManager } from './core/plugin';
export * from './plugins';

// WebSocket exports
export * from './websocket';

// GraphQL exports
export * from './graphql';

// Documentation exports
export { OpenAPIGenerator } from './docs/openapi-generator';
export { ZodToJsonSchemaConverter, zodToJsonSchema } from './docs/zod-to-json-schema';

// Adapter exports
export * from './adapters/base';
export { HonoAdapter } from './adapters/hono';
export { ExpressAdapter } from './adapters/express';

// Type exports
export * from './types';

// Testing utilities exports
export * from './testing';

// Authentication exports
export * from './auth/exceptions';
export * from './auth/jwt-provider';
export * from './auth/auth-service';
export * from './auth/rbac';
export * from './auth/rbac-plugin';
export * from './auth/auth-plugin';
export * from './auth/decorators';
export * from './auth/rbac-decorators';
// OAuth exports (specific exports to avoid conflicts)
export type { OAuthProvider } from './auth/oauth-provider';
export { OAuthUserSchema } from './auth/oauth-provider';
export { OAuth, OAuthUser, OAuthToken, getOAuthUser, getOAuthToken, isOAuthAuthenticated, getOAuthProvider } from './auth/oauth-decorators';

// Session exports (specific exports to avoid conflicts)  
export { SessionManager, SessionDataSchema } from './auth/session';
export type { SessionStore } from './auth/session';
export { Session, CurrentSession, CSRFToken, RequireCSRF, createSessionMiddleware, SessionGuard, getCurrentSession, getSessionManager, getCSRFProtection, getSessionData, isSessionAuthenticated, getSessionUserId, setSessionData, removeSessionData } from './auth/session-decorators';
export type { SessionData } from './auth/session-decorators';

// ORM and Transaction exports
export * from './orm';

// Logging exports
export * from './logging';

// Request Context exports
export * from './context/request-context';

// Cache exports
export * from './cache';

// Health check plugin
export * from './plugins/health';