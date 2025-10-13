// WebSocket manager for connection tracking and room management
import type { WebSocketMetadata, Class } from '../types';
import { WebSocketConnection } from './connection';

/**
 * WebSocketManager handles WebSocket connection lifecycle,
 * connection tracking, and room-based broadcasting
 */
export class WebSocketManager {
  private connections: Map<string, WebSocketConnection> = new Map();
  private rooms: Map<string, Set<string>> = new Map();
  private connectionsByRoom: Map<string, Set<WebSocketConnection>> = new Map();

  /**
   * Register a new WebSocket connection
   * @param ws - Native WebSocket instance
   * @param metadata - WebSocket route metadata
   * @returns The created WebSocketConnection
   */
  handleConnection(ws: WebSocket, metadata: WebSocketMetadata): WebSocketConnection {
    const connection = new WebSocketConnection(ws, this);
    this.connections.set(connection.id, connection);

    // Execute onConnect handler if defined
    if (metadata.onConnect) {
      this.executeHandler(metadata, metadata.onConnect, connection);
    }

    // Set up message handler
    ws.addEventListener('message', async (event) => {
      await this.handleMessage(event, connection, metadata);
    });

    // Set up close handler
    ws.addEventListener('close', () => {
      this.handleDisconnect(connection, metadata);
    });

    // Set up error handler
    ws.addEventListener('error', (error) => {
      console.error(`WebSocket error for connection ${connection.id}:`, error);
    });

    return connection;
  }

  /**
   * Handle incoming WebSocket message
   */
  private async handleMessage(
    event: MessageEvent,
    connection: WebSocketConnection,
    metadata: WebSocketMetadata
  ): Promise<void> {
    if (!metadata.onMessage) {
      return;
    }

    let data: any;

    try {
      // Parse message data
      data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;

      // Validate with schema if provided
      if (metadata.messageSchema) {
        data = await metadata.messageSchema.parseAsync(data);
      }

      // Execute onMessage handler
      await this.executeHandler(metadata, metadata.onMessage, connection, data);
    } catch (error) {
      // Send error back to client without closing connection
      connection.send({
        error: 'Invalid message format',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Handle WebSocket disconnection
   */
  private handleDisconnect(connection: WebSocketConnection, metadata: WebSocketMetadata): void {
    // Remove from all rooms
    Array.from(this.connectionsByRoom.entries()).forEach(([room, connections]) => {
      connections.delete(connection);
      if (connections.size === 0) {
        this.connectionsByRoom.delete(room);
      }
    });

    // Remove from rooms tracking
    Array.from(this.rooms.entries()).forEach(([room, connectionIds]) => {
      connectionIds.delete(connection.id);
      if (connectionIds.size === 0) {
        this.rooms.delete(room);
      }
    });

    // Remove from connections map
    this.connections.delete(connection.id);
    connection._markClosed();

    // Execute onDisconnect handler if defined
    if (metadata.onDisconnect) {
      this.executeHandler(metadata, metadata.onDisconnect, connection);
    }
  }

  /**
   * Execute a handler method on the target class
   */
  private async executeHandler(
    metadata: WebSocketMetadata,
    methodName: string,
    connection: WebSocketConnection,
    data?: any
  ): Promise<void> {
    try {
      const instance = new metadata.target();
      const method = (instance as any)[methodName];

      if (typeof method === 'function') {
        if (data !== undefined) {
          await method.call(instance, connection, data);
        } else {
          await method.call(instance, connection);
        }
      }
    } catch (error) {
      console.error(`Error executing WebSocket handler ${methodName}:`, error);
    }
  }

  /**
   * Broadcast a message to all connections or connections in a specific room
   * @param message - Message to broadcast
   * @param room - Optional room name
   */
  broadcast(message: any, room?: string): void {
    const connections = room
      ? this.getConnectionsInRoom(room)
      : Array.from(this.connections.values());

    const data = typeof message === 'string' ? message : JSON.stringify(message);

    for (const connection of connections) {
      if (connection.isOpen) {
        connection.send(data);
      }
    }
  }

  /**
   * Add a connection to a room
   * @param connectionId - Connection ID
   * @param room - Room name
   */
  joinRoom(connectionId: string, room: string): void {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      return;
    }

    // Add to rooms map (connectionId -> room)
    if (!this.rooms.has(room)) {
      this.rooms.set(room, new Set());
    }
    this.rooms.get(room)!.add(connectionId);

    // Add to connectionsByRoom map (room -> connections)
    if (!this.connectionsByRoom.has(room)) {
      this.connectionsByRoom.set(room, new Set());
    }
    this.connectionsByRoom.get(room)!.add(connection);
  }

  /**
   * Remove a connection from a room
   * @param connectionId - Connection ID
   * @param room - Room name
   */
  leaveRoom(connectionId: string, room: string): void {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      return;
    }

    // Remove from rooms map
    const roomConnections = this.rooms.get(room);
    if (roomConnections) {
      roomConnections.delete(connectionId);
      if (roomConnections.size === 0) {
        this.rooms.delete(room);
      }
    }

    // Remove from connectionsByRoom map
    const connections = this.connectionsByRoom.get(room);
    if (connections) {
      connections.delete(connection);
      if (connections.size === 0) {
        this.connectionsByRoom.delete(room);
      }
    }
  }

  /**
   * Get all connections in a specific room
   * @param room - Room name
   * @returns Array of connections in the room
   */
  private getConnectionsInRoom(room: string): WebSocketConnection[] {
    const connections = this.connectionsByRoom.get(room);
    return connections ? Array.from(connections) : [];
  }

  /**
   * Get a connection by ID
   * @param connectionId - Connection ID
   * @returns The connection or undefined
   */
  getConnection(connectionId: string): WebSocketConnection | undefined {
    return this.connections.get(connectionId);
  }

  /**
   * Get all active connections
   * @returns Array of all connections
   */
  getAllConnections(): WebSocketConnection[] {
    return Array.from(this.connections.values());
  }

  /**
   * Get the number of active connections
   * @returns Number of connections
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Get all room names
   * @returns Array of room names
   */
  getRooms(): string[] {
    return Array.from(this.rooms.keys());
  }

  /**
   * Get the number of connections in a room
   * @param room - Room name
   * @returns Number of connections in the room
   */
  getRoomSize(room: string): number {
    return this.rooms.get(room)?.size || 0;
  }
}
