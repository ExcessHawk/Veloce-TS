// WebSocket manager for connection tracking and room management
import type { WebSocketMetadata } from '../types/index.js';
import type { DIContainer } from '../dependencies/container.js';
import type { WebSocketPluginConfig } from './plugin.js';
import { WebSocketConnection } from './connection.js';
import { getLogger } from '../logging/logger.js';

/** Default heartbeat ping interval (30 seconds). */
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
/** Default maximum inbound message size (1 MiB). */
const DEFAULT_MAX_MESSAGE_SIZE_BYTES = 1_048_576;
/** WebSocket close code: Message Too Big (RFC 6455). */
const CLOSE_MESSAGE_TOO_BIG = 1009;
/** WebSocket close code: Going Away — used for heartbeat/idle terminations. */
const CLOSE_GOING_AWAY = 1001;

/**
 * Per-connection runtime state used by the heartbeat and idle-timeout
 * features. Kept in a side map (not on the connection) so the public
 * WebSocketConnection API stays unchanged.
 */
interface ConnectionState {
  /** Timestamp (ms) of the last inbound message from the client. */
  lastSeen: number;
  /** Idle-timeout timer, re-armed on every inbound message. */
  idleTimer?: ReturnType<typeof setTimeout>;
  /** Heartbeat interval timer (ping + liveness check). */
  heartbeatTimer?: ReturnType<typeof setInterval>;
}

/**
 * WebSocketManager handles WebSocket connection lifecycle,
 * connection tracking, and room-based broadcasting.
 *
 * Hardening features (all configured via {@link WebSocketPluginConfig}):
 * - Heartbeat keepalive: periodic pings with liveness checks. Dead
 *   connections are closed (1001) and removed from the registry/rooms.
 * - Idle timeout: connections with no inbound messages for
 *   `idleTimeoutMs` are closed (1001).
 * - Max message size: oversized inbound messages get an error frame and
 *   the connection is closed with 1009 (Message Too Big).
 */
export class WebSocketManager {
  private connections: Map<string, WebSocketConnection> = new Map();
  private rooms: Map<string, Set<string>> = new Map();
  private connectionsByRoom: Map<string, Set<WebSocketConnection>> = new Map();
  private states: Map<string, ConnectionState> = new Map();

  /** DI container used to resolve gateway instances (set by the plugin). */
  private container?: DIContainer;

  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatTimeoutMs: number;
  private readonly idleTimeoutMs: number;
  private readonly maxMessageSizeBytes: number;

  constructor(config: WebSocketPluginConfig = {}) {
    this.heartbeatIntervalMs = config.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.heartbeatTimeoutMs = config.heartbeatTimeoutMs ?? this.heartbeatIntervalMs * 2;
    this.idleTimeoutMs = config.idleTimeoutMs ?? 0;
    this.maxMessageSizeBytes = config.maxMessageSizeBytes ?? DEFAULT_MAX_MESSAGE_SIZE_BYTES;
  }

  /**
   * Provide the DI container used to resolve gateway instances.
   * Called by WebSocketPlugin.install() with the application container.
   */
  setContainer(container: DIContainer): void {
    this.container = container;
  }

  /**
   * Register a new WebSocket connection using standard `addEventListener`
   * wiring (suitable for sockets implementing the WHATWG WebSocket API).
   * @param ws - Native WebSocket instance
   * @param metadata - WebSocket route metadata
   * @returns The created WebSocketConnection
   */
  handleConnection(ws: WebSocket, metadata: WebSocketMetadata): WebSocketConnection {
    const connection = this.openConnection(ws, metadata);

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
      getLogger().error(
        'WebSocket transport error',
        error instanceof Error ? error : new Error(String(error)),
        { connectionId: connection.id, path: metadata.path }
      );
    });

    return connection;
  }

  /**
   * Register a connection without attaching event listeners. Used when the
   * runtime delivers events through its own callbacks (Bun's `Bun.serve()`
   * websocket handlers, Deno's `socket.onmessage`/`onclose` assignments).
   * Starts heartbeat/idle timers and runs the onConnect handler.
   */
  openConnection(ws: WebSocket, metadata: WebSocketMetadata): WebSocketConnection {
    const connection = new WebSocketConnection(ws, this);
    this.connections.set(connection.id, connection);

    const state: ConnectionState = { lastSeen: Date.now() };
    this.states.set(connection.id, state);
    this.armIdleTimer(connection, metadata, state);
    this.armHeartbeat(connection, metadata, state);

    // Execute onConnect handler if defined
    if (metadata.onConnect) {
      this.executeHandler(metadata, metadata.onConnect, connection);
    }

    return connection;
  }

  /**
   * Bun-specific: register connection without addEventListener (Bun WS has no addEventListener).
   * Called from the Bun websocket.open handler in HonoAdapter.
   */
  handleConnectionBun(ws: any, metadata: WebSocketMetadata): WebSocketConnection {
    return this.openConnection(ws, metadata);
  }

  /**
   * Bun-specific: handle an incoming message. Called from websocket.message in HonoAdapter.
   */
  async handleMessageBun(
    // `Uint8Array`, not `Buffer`: this signature is part of the published
    // declarations, and naming `Buffer` there forces every consumer to install
    // @types/node just to type-check an import of veloce-ts. Buffer extends
    // Uint8Array, so what Bun actually hands us still fits.
    message: string | Uint8Array,
    connection: WebSocketConnection,
    metadata: WebSocketMetadata
  ): Promise<void> {
    // Keep binary payloads as-is so the size check measures real bytes;
    // handleMessage stringifies/parses only string payloads.
    const data = typeof message === 'string' ? message : message;
    const event = { data } as MessageEvent;
    await this.handleMessage(event, connection, metadata);
  }

  /**
   * Bun-specific: handle disconnection. Called from websocket.close in HonoAdapter.
   */
  handleDisconnectBun(connection: WebSocketConnection, metadata: WebSocketMetadata): void {
    this.handleDisconnect(connection, metadata);
  }

  /**
   * Handle incoming WebSocket message.
   *
   * Order of operations:
   * 1. Enforce `maxMessageSizeBytes` (error frame + close 1009).
   * 2. Record liveness (heartbeat) and re-arm the idle timer.
   * 3. Intercept heartbeat control frames (`{"type":"ping"|"pong"}`)
   *    when the heartbeat is enabled.
   * 4. Validate with the message schema and dispatch to the handler.
   */
  async handleMessage(
    event: MessageEvent,
    connection: WebSocketConnection,
    metadata: WebSocketMetadata
  ): Promise<void> {
    const raw = event.data;

    // 1. Enforce maximum inbound message size
    const size = this.byteSize(raw);
    if (size > this.maxMessageSizeBytes) {
      connection.send({
        error: 'Message too large',
        maxMessageSizeBytes: this.maxMessageSizeBytes
      });
      this.terminate(connection, metadata, CLOSE_MESSAGE_TOO_BIG, 'Message too large');
      return;
    }

    // 2. Any inbound frame counts as activity for heartbeat/idle tracking
    this.touch(connection, metadata);

    // 3. Intercept application-level heartbeat control frames so they are
    //    not forwarded to @OnMessage handlers (only when heartbeat is on).
    if (this.heartbeatIntervalMs > 0 && typeof raw === 'string') {
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = undefined; // fall through — normal error handling below
      }
      if (parsed && typeof parsed === 'object') {
        if (parsed.type === 'pong') {
          return; // liveness already recorded by touch()
        }
        if (parsed.type === 'ping') {
          connection.send({ type: 'pong' });
          return;
        }
      }
    }

    if (!metadata.onMessage) {
      return;
    }

    let data: any;

    try {
      // Parse message data
      data = typeof raw === 'string' ? JSON.parse(raw) : raw;

      // Validate with schema if provided
      if (metadata.messageSchema) {
        data = await metadata.messageSchema.parseAsync(data);
      }

      // Execute onMessage handler
      await this.executeHandler(metadata, metadata.onMessage, connection, data);
    } catch (error) {
      // Only parsing/schema problems describe the client's own input; anything
      // else (a failing query, a bug in the gateway) is internal and must not be
      // echoed back — that would leak driver messages and stack detail.
      const isClientInput = error instanceof SyntaxError || (error as any)?.name === 'ZodError';

      if (isClientInput) {
        connection.send({
          error: 'Invalid message format',
          details: error instanceof Error ? error.message : 'Unknown error'
        });
      } else {
        getLogger().error(
          'WebSocket message handler failed',
          error instanceof Error ? error : new Error(String(error)),
          { path: metadata.path, handler: metadata.onMessage, connectionId: connection.id }
        );
        connection.send({ error: 'Internal server error' });
      }
    }
  }

  /**
   * Handle WebSocket disconnection.
   * Idempotent: safe to call both from server-initiated terminations
   * (heartbeat/idle/oversize) and from the runtime's close event.
   */
  handleDisconnect(connection: WebSocketConnection, metadata: WebSocketMetadata): void {
    // Already cleaned up (e.g., terminated by a timer before the runtime
    // close event fired) — avoid running onDisconnect twice.
    if (!this.connections.has(connection.id)) {
      return;
    }

    // Stop timers and drop runtime state
    const state = this.states.get(connection.id);
    if (state) {
      if (state.idleTimer) clearTimeout(state.idleTimer);
      if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
      this.states.delete(connection.id);
    }

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
   * Measure the byte size of an inbound payload without copying when
   * possible. Strings are measured as UTF-8.
   */
  private byteSize(raw: unknown): number {
    if (typeof raw === 'string') {
      return new TextEncoder().encode(raw).byteLength;
    }
    if (raw instanceof ArrayBuffer) {
      return raw.byteLength;
    }
    if (ArrayBuffer.isView(raw)) {
      return raw.byteLength; // covers Buffer, Uint8Array, DataView, ...
    }
    if (typeof Blob !== 'undefined' && raw instanceof Blob) {
      return raw.size;
    }
    return 0;
  }

  /**
   * Record inbound activity for a connection: refresh the heartbeat
   * liveness timestamp and re-arm the idle timer.
   */
  private touch(connection: WebSocketConnection, metadata: WebSocketMetadata): void {
    const state = this.states.get(connection.id);
    if (!state) {
      return;
    }
    state.lastSeen = Date.now();
    this.armIdleTimer(connection, metadata, state);
  }

  /**
   * (Re)arm the idle-timeout timer for a connection.
   * No-op when `idleTimeoutMs` is 0/undefined.
   */
  private armIdleTimer(
    connection: WebSocketConnection,
    metadata: WebSocketMetadata,
    state: ConnectionState
  ): void {
    if (this.idleTimeoutMs <= 0) {
      return;
    }
    if (state.idleTimer) {
      clearTimeout(state.idleTimer);
    }
    state.idleTimer = setTimeout(() => {
      this.terminate(connection, metadata, CLOSE_GOING_AWAY, 'Idle timeout');
    }, this.idleTimeoutMs);
    // Don't keep the process alive just for idle timers (Bun/Node timers).
    (state.idleTimer as any).unref?.();
  }

  /**
   * Start the heartbeat interval for a connection.
   * Each tick first checks liveness (`lastSeen` within `heartbeatTimeoutMs`),
   * then sends a ping: protocol-level `ws.ping()` when available (Bun) plus
   * a portable application-level `{"type":"ping"}` frame.
   *
   * Limitation: protocol-level pong replies are not observable here (Bun
   * routes them to a `pong` handler on `Bun.serve()`; Deno's upgraded
   * sockets expose no `ping()`), so liveness is measured by ANY inbound
   * traffic, including the app-level `{"type":"pong"}` reply.
   */
  private armHeartbeat(
    connection: WebSocketConnection,
    metadata: WebSocketMetadata,
    state: ConnectionState
  ): void {
    if (this.heartbeatIntervalMs <= 0) {
      return;
    }
    state.heartbeatTimer = setInterval(() => {
      const current = this.states.get(connection.id);
      if (!current) {
        // Connection already cleaned up; stop the timer defensively.
        if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
        return;
      }
      if (Date.now() - current.lastSeen >= this.heartbeatTimeoutMs) {
        this.terminate(connection, metadata, CLOSE_GOING_AWAY, 'Heartbeat timeout');
        return;
      }
      this.sendPing(connection);
    }, this.heartbeatIntervalMs);
    // Don't keep the process alive just for heartbeat timers.
    (state.heartbeatTimer as any).unref?.();
  }

  /**
   * Send a heartbeat ping to a connection.
   */
  private sendPing(connection: WebSocketConnection): void {
    const ws = connection.native as any;
    try {
      if (ws && typeof ws.ping === 'function') {
        ws.ping(); // protocol-level ping (Bun) — keeps intermediaries alive
      }
    } catch {
      // ignore — the app-level ping below is the portable probe
    }
    connection.send({ type: 'ping' });
  }

  /**
   * Close a connection server-side and immediately clean it from the
   * registry and rooms. The subsequent runtime close event is a no-op
   * thanks to the idempotency guard in handleDisconnect().
   */
  private terminate(
    connection: WebSocketConnection,
    metadata: WebSocketMetadata,
    code: number,
    reason: string
  ): void {
    try {
      connection.close(code, reason);
    } catch (error) {
      getLogger().error(
        'Error closing WebSocket connection',
        error instanceof Error ? error : new Error(String(error)),
        { connectionId: connection.id, code, reason }
      );
    }
    this.handleDisconnect(connection, metadata);
  }

  /**
   * Execute a handler method on the target class.
   * The gateway instance is resolved through the application's DI container
   * when available (set via setContainer()); `metadata.instance` acts as a
   * cache so resolution happens at most once per gateway.
   */
  private async executeHandler(
    metadata: WebSocketMetadata,
    methodName: string,
    connection: WebSocketConnection,
    data?: any
  ): Promise<void> {
    try {
      let instance = metadata.instance;
      if (!instance) {
        instance = this.container
          ? await this.container.resolve(metadata.target)
          : new metadata.target();
        metadata.instance = instance;
      }
      const method = (instance as any)[methodName];

      if (typeof method === 'function') {
        if (data !== undefined) {
          await method.call(instance, connection, data);
        } else {
          await method.call(instance, connection);
        }
      }
    } catch (error) {
      getLogger().error(
        'WebSocket handler threw',
        error instanceof Error ? error : new Error(String(error)),
        { handler: methodName, connectionId: connection.id, path: metadata.path }
      );
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
