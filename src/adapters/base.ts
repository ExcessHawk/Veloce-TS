/**
 * Base adapter interface for runtime-agnostic server implementations
 * Adapters allow FastAPI-TS to run on different runtimes (Bun, Node.js, Deno, Workers)
 * and integrate with different frameworks (Hono, Express)
 */
export interface Adapter {
  /**
   * Name of the adapter (e.g., 'hono', 'express', 'native')
   */
  name: string;

  /**
   * Start the server and listen on the specified port
   * @param port - Port number to listen on
   * @param callback - Optional callback to execute when server starts
   * @returns Server instance (type varies by runtime)
   */
  listen(port: number, callback?: () => void): any;

  /**
   * Get the native handler for the underlying framework/runtime
   * @returns Handler function (e.g., Hono's fetch, Express app)
   */
  getHandler(): any;
}
