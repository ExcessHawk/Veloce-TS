// WebSocket Plugin
import type { Plugin } from '../core/plugin';
import type { VeloceTS } from '../core/application';
import { WebSocketManager } from './manager';

/**
 * WebSocketPlugin adds WebSocket support to Veloce-TS
 * Registers WebSocket routes and handles connection upgrades
 */
export class WebSocketPlugin implements Plugin {
  name = 'websocket';
  version = '1.0.0';

  private manager: WebSocketManager;

  constructor() {
    this.manager = new WebSocketManager();
  }

  async install(app: VeloceTS): Promise<void> {
    const metadata = app.getMetadata();
    const websockets = metadata.getWebSockets();

    // Register each WebSocket handler
    for (const ws of websockets) {
      this.registerWebSocket(app, ws);
    }
  }

  /**
   * Register a WebSocket route with the application
   */
  private registerWebSocket(app: VeloceTS, metadata: any): void {
    const hono = app.getHono();

    // Register WebSocket upgrade endpoint
    hono.get(metadata.path, async (c) => {
      // Check if this is a WebSocket upgrade request
      const upgrade = c.req.header('upgrade');
      
      if (upgrade?.toLowerCase() !== 'websocket') {
        return c.text('Expected WebSocket upgrade', 426);
      }

      // Handle WebSocket upgrade based on runtime
      return this.handleUpgrade(c, metadata);
    });
  }

  /**
   * Handle WebSocket upgrade for different runtimes
   */
  private handleUpgrade(c: any, metadata: any): Response {
    // Detect runtime and handle accordingly
    if (typeof Bun !== 'undefined') {
      return this.handleBunUpgrade(c, metadata);
    } else if (typeof (globalThis as any).Deno !== 'undefined') {
      return this.handleDenoUpgrade(c, metadata);
    } else {
      // Node.js or other runtimes
      return this.handleNodeUpgrade(c, metadata);
    }
  }

  /**
   * Handle WebSocket upgrade for Bun runtime
   *
   * Bun's WebSocket API requires that event handlers (open/message/close/error)
   * are provided as a `websocket` option to `Bun.serve()`. Because Veloce uses
   * Hono on top of Bun, we pass the manager callbacks via the upgrade `data`
   * object so they can be invoked from the Bun serve websocket handler.
   */
  private handleBunUpgrade(c: any, metadata: any): Response {
    const bunEnv = c.env as any;

    if (!bunEnv?.upgrade) {
      return c.text('WebSocket upgrade not supported in this environment', 501);
    }

    const success = bunEnv.upgrade(c.req.raw, {
      data: { manager: this.manager, metadata }
    });

    if (!success) {
      return c.text('WebSocket upgrade failed', 500);
    }

    // Bun handles the actual response; returning undefined signals Hono to stop
    return undefined as any;
  }

  /**
   * Handle WebSocket upgrade for Deno runtime
   */
  private handleDenoUpgrade(c: any, metadata: any): Response {
    const Deno = (globalThis as any).Deno;
    const { socket, response } = Deno.upgradeWebSocket(c.req.raw);
    
    // Set up WebSocket handlers
    socket.onopen = () => {
      this.manager.handleConnection(socket as any, metadata);
    };

    return response;
  }

  /**
   * Handle WebSocket upgrade for Node.js runtime
   */
  private handleNodeUpgrade(c: any, metadata: any): Response {
    // For Node.js, we need to handle this differently
    // This is a simplified version - in production, you'd use a library like 'ws'
    return c.text('WebSocket support requires Bun or Deno runtime', 501);
  }

  /**
   * Get the WebSocket manager instance
   */
  getManager(): WebSocketManager {
    return this.manager;
  }

  /**
   * Broadcast a message to all connections or a specific room
   */
  broadcast(message: any, room?: string): void {
    this.manager.broadcast(message, room);
  }

  /**
   * Get connection count
   */
  getConnectionCount(): number {
    return this.manager.getConnectionCount();
  }

  /**
   * Get all active rooms
   */
  getRooms(): string[] {
    return this.manager.getRooms();
  }
}
