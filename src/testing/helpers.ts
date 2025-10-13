import { VeloceTS } from '../core/application';
import { TestClient } from './test-client';
import type { VeloceTSConfig, Provider, ProviderConfig } from '../types';

/**
 * Create a test instance of VeloceTS application
 * This is useful for creating isolated test instances with specific configurations
 * 
 * @param config - Optional configuration for the test app
 * @returns A new VeloceTS instance configured for testing
 * 
 * @example
 * ```typescript
 * const app = createTestApp({ docs: false });
 * app.get('/test', { handler: () => ({ message: 'test' }) });
 * await app.compile();
 * 
 * const client = new TestClient(app);
 * const response = await client.get('/test');
 * ```
 */
export function createTestApp(config?: VeloceTSConfig): VeloceTS {
  // Default test configuration
  const testConfig: VeloceTSConfig = {
    docs: false, // Disable docs by default in tests
    cors: false, // Disable CORS by default in tests
    ...config,
  };

  return new VeloceTS(testConfig);
}

/**
 * Mock a dependency in the DI container
 * This allows you to replace real dependencies with mocks for testing
 * 
 * @param app - The VeloceTS application instance
 * @param provider - The provider to mock
 * @param mockValue - The mock value or factory function
 * @param config - Optional provider configuration
 * 
 * @example
 * ```typescript
 * class UserService {
 *   getUser(id: string) { return { id, name: 'Real User' }; }
 * }
 * 
 * const app = createTestApp();
 * const mockUserService = { getUser: (id: string) => ({ id, name: 'Mock User' }) };
 * 
 * mockDependency(app, UserService, mockUserService);
 * ```
 */
export function mockDependency<T>(
  app: VeloceTS,
  provider: Provider<T>,
  mockValue: T | (() => T | Promise<T>),
  config?: ProviderConfig
): void {
  const container = app.getContainer();

  // Create a factory that returns the mock value
  const factory = typeof mockValue === 'function' 
    ? (mockValue as () => T | Promise<T>)
    : () => mockValue;

  // Register the mock with the container
  container.register(provider, {
    scope: config?.scope || 'singleton',
    factory,
  });
}

/**
 * Create a test client for an application
 * This is a convenience function that creates a TestClient instance
 * 
 * @param app - The VeloceTS application instance
 * @returns A TestClient instance for making test requests
 * 
 * @example
 * ```typescript
 * const app = createTestApp();
 * app.get('/hello', { handler: () => ({ message: 'Hello' }) });
 * await app.compile();
 * 
 * const client = createTestClient(app);
 * const response = await client.get('/hello');
 * ```
 */
export function createTestClient(app: VeloceTS): TestClient {
  return new TestClient(app);
}

/**
 * Setup a test application with routes and compile it
 * This is a convenience function for quickly setting up test scenarios
 * 
 * @param setup - Function that sets up routes on the app
 * @param config - Optional configuration for the test app
 * @returns Object containing the app and client
 * 
 * @example
 * ```typescript
 * const { app, client } = await setupTestApp((app) => {
 *   app.get('/users', { handler: () => [{ id: 1, name: 'User' }] });
 *   app.post('/users', { handler: (c) => ({ id: 2, name: 'New User' }) });
 * });
 * 
 * const response = await client.get('/users');
 * ```
 */
export async function setupTestApp(
  setup: (app: VeloceTS) => void | Promise<void>,
  config?: VeloceTSConfig
): Promise<{ app: VeloceTS; client: TestClient }> {
  const app = createTestApp(config);
  
  await setup(app);
  await app.compile();
  
  const client = createTestClient(app);
  
  return { app, client };
}

/**
 * Clear all mocked dependencies from an application
 * This is useful for cleaning up between tests
 * 
 * @param app - The VeloceTS application instance
 * 
 * @example
 * ```typescript
 * afterEach(() => {
 *   clearMocks(app);
 * });
 * ```
 */
export function clearMocks(app: VeloceTS): void {
  const container = app.getContainer();
  container.clear();
}
