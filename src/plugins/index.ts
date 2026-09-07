/**
 * @module veloce-ts/plugins
 * @description Plugins oficiales re-exportados: OpenAPI/Swagger, WebSocket, GraphQL y health checks.
 */
export { OpenAPIPlugin } from './openapi.js';
export type { OpenAPIPluginOptions, SwaggerUIAssets } from './openapi.js';
export { WebSocketPlugin } from '../websocket/plugin.js';
export { GraphQLPlugin } from '../graphql/plugin.js';
export { HealthCheckPlugin, HealthCheckers } from './health.js';
export type { HealthCheckOptions, HealthCheckResult, CheckResult, HealthChecker } from './health.js';
