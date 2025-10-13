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
export * from './decorators/params';
export * from './decorators/dependencies';
export * from './decorators/middleware';
export * from './decorators/docs';
export * from './decorators/websocket';
export * from './decorators/graphql';

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
