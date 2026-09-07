/**
 * @module veloce-ts/adapters/base
 * @description {@link Adapter} / {@link ServerInstance} contract: abstracts `listen` and graceful
 * shutdown across runtimes (Bun, Node, …) and backends (Hono, Express).
 */

/**
 * Server instance interface for graceful shutdown
 */
export interface ServerInstance {
  port: number;
  close(): Promise<void> | void;
  /**
   * The runtime's own server object, untouched.
   *
   * Present on the Node backend, where the returned instance is a plain copy
   * that has lost `http.Server`'s prototype — anything that needs the real
   * object (attaching a WebSocket upgrade listener, for one) must use this.
   */
  raw?: unknown;
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
   * @returns Server instance with close() method for graceful shutdown.
   *   May be returned asynchronously — the Node backend loads its server
   *   package on demand, which is only possible with a dynamic import.
   */
  listen(port: number, callback?: () => void): ServerInstance | Promise<ServerInstance>;

  /**
   * Get the native handler for the underlying framework/runtime
   * @returns Handler function (e.g., Hono's fetch, Express app)
   */
  getHandler(): any;
}
