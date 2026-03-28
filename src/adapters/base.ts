/**
 * @module veloce-ts/adapters/base
 * @description Contrato {@link ServerAdapter} / {@link ServerInstance}: abstrae `listen` y cierre graceful
 * sobre distintos runtimes (Bun, Node, etc.) y backends (Hono, Express).
 */

/**
 * Server instance interface for graceful shutdown
 */
export interface ServerInstance {
  port: number;
  close(): Promise<void> | void;
  [key: string]: any;
}

export interface Adapter {
  /**
   * Name of the adapter (e.g., 'hono', 'express', 'native')
   */
  name: string;

  /**
   * Start the server and listen on the specified port
   * @param port - Port number to listen on
   * @param callback - Optional callback to execute when server starts
   * @returns Server instance with close() method for graceful shutdown
   */
  listen(port: number, callback?: () => void): ServerInstance;

  /**
   * Get the native handler for the underlying framework/runtime
   * @returns Handler function (e.g., Hono's fetch, Express app)
   */
  getHandler(): any;
}
