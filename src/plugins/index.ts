/**
 * @module veloce-ts/plugins
 * @description Plugins oficiales re-exportados: OpenAPI/Swagger, WebSocket, GraphQL y health checks.
 */
export { OpenAPIPlugin } from './openapi';
export { WebSocketPlugin } from '../websocket/plugin';
export { GraphQLPlugin } from '../graphql/plugin';
export { HealthCheckPlugin, HealthCheckers } from './health';
export type { HealthCheckOptions, HealthCheckResult, CheckResult, HealthChecker } from './health';
