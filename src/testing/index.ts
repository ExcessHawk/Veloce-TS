/**
 * @module veloce-ts/testing
 * @description {@link TestClient}, {@link TestResponse} y helpers (`setupTestApp`, `mockDependency`) para pruebas de integración contra la app Hono interna.
 */
export { TestClient, TestResponse } from './test-client';
export type { TestRequestOptions } from './test-client';
export {
  createTestApp,
  createTestClient,
  mockDependency,
  setupTestApp,
  clearMocks,
} from './helpers';
