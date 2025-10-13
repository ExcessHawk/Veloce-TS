// WebSocket Plugin
import type { Plugin } from '../core/plugin';
import type { FastAPITS } from '../core/application';
import { WebSocketManager } from './manager';

/**
 * WebSocketPlugin adds WebSocket support to FastAPI-TS
 * Registers WebSocket routes and handles connection upgrades
 */
export class WebSocketPlugin implements Plugin {
  name = 'websocket';
  version = '1.0.0';

  private manager: WebSocketManager;

  constructor() {
    this.manager = new WebSocketManager();
  }

  async install(app: FastAPITS): Promise<void> {
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
  private registerWebSocket(app: FastAPITS, metadata: any): void {
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
   */
  private handleBunUpgrade(c: any, metadata: any): Response {
    const success = (c.env as any)?.upgrade?.(c.req.raw);
    
    if (!success) {
      return c.text('WebSocket upgrade failed', 500);
    }

    return new Response(null, { status: 101 });
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
