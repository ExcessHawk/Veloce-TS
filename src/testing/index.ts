/**
 * @module veloce-ts/testing
 * @description {@link TestClient}, {@link TestResponse} and helpers (`setupTestApp`, `mockDependency`) for integration tests against the internal Hono app.
 */
export { TestClient, TestResponse } from './test-client.js';
export type { TestRequestOptions } from './test-client.js';
export {
  createTestApp,
  createTestClient,
  mockDependency,
  setupTestApp,
  clearMocks,
} from './helpers.js';
export { isolate, compileTestApp } from './isolate.js';
