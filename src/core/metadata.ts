// Metadata registry for storing decorator metadata
import 'reflect-metadata';
import type {
  RouteMetadata,
  ParameterMetadata,
  DependencyMetadata,
  ControllerMetadata,
  Class,
  HTTPMethod,
  Middleware,
  RouteDocumentation,
  ResponseMetadata,
  WebSocketMetadata,
  WebSocketHandlerMetadata,
  GraphQLResolverMetadata,
  GraphQLFieldMetadata
} from '../types';

// Metadata keys for reflect-metadata
const ROUTE_METADATA_KEY = Symbol('route:metadata');
const CONTROLLER_METADATA_KEY = Symbol('controller:metadata');
const PARAMETER_METADATA_KEY = Symbol('parameter:metadata');
const DEPENDENCY_METADATA_KEY = Symbol('dependency:metadata');
const WEBSOCKET_METADATA_KEY = Symbol('websocket:metadata');
const WEBSOCKET_HANDLER_METADATA_KEY = Symbol('websocket:handler:metadata');
const GRAPHQL_RESOLVER_KEY = Symbol('graphql:resolver');
const GRAPHQL_FIELD_KEY = Symbol('graphql:field');

export class MetadataRegistry {
  private routes: Map<string, RouteMetadata> = new Map();
  private controllers: Map<Class, ControllerMetadata> = new Map();
  private routesByController: Map<Class, RouteMetadata[]> = new Map();
  private websockets: Map<Class, WebSocketMetadata> = new Map();
  private graphqlResolvers: Map<Class, GraphQLResolverMetadata> = new Map();
  private graphqlFields: Map<string, GraphQLFieldMetadata> = new Map();

  /**
   * Register a route in the registry
   */
  registerRoute(metadata: RouteMetadata): void {
    const key = this.getRouteKey(metadata.target, metadata.propertyKey);
    this.routes.set(key, metadata);

    // Also track routes by controller
    if (!this.routesByController.has(metadata.target)) {
      this.routesByController.set(metadata.target, []);
    }
    this.routesByController.get(metadata.target)!.push(metadata);
  }

  /**
   * Register a controller in the registry
   */
  registerController(target: Class, metadata: ControllerMetadata): void {
    this.controllers.set(target, metadata);
  }

  /**
   * Get all registered routes
   */
  getRoutes(): RouteMetadata[] {
    return Array.from(this.routes.values());
  }

  /**
   * Get a specific route by target and property key
   */
  getRoute(target: Class, propertyKey: string): RouteMetadata | undefined {
    const key = this.getRouteKey(target, propertyKey);
    return this.routes.get(key);
  }

  /**
   * Get all routes for a specific controller
   */
  getRoutesByController(target: Class): RouteMetadata[] {
    return this.routesByController.get(target) || [];
  }

  /**
   * Get controller metadata
   */
  getController(target: Class): ControllerMetadata | undefined {
    return this.controllers.get(target);
  }

  /**
   * Get all registered controllers
   */
  getControllers(): Map<Class, ControllerMetadata> {
    return new Map(this.controllers);
  }

  /**
   * Register a WebSocket handler in the registry
   */
  registerWebSocket(metadata: WebSocketMetadata): void {
    this.websockets.set(metadata.target, metadata);
  }

  /**
   * Get all registered WebSocket handlers
   */
  getWebSockets(): WebSocketMetadata[] {
    return Array.from(this.websockets.values());
  }

  /**
   * Get WebSocket metadata for a specific target
   */
  getWebSocket(target: Class): WebSocketMetadata | undefined {
    return this.websockets.get(target);
  }

  /**
   * Register a GraphQL resolver in the registry
   */
  registerGraphQLResolver(metadata: GraphQLResolverMetadata): void {
    this.graphqlResolvers.set(metadata.target, metadata);
  }

  /**
   * Register a GraphQL field in the registry
   */
  registerGraphQLField(metadata: GraphQLFieldMetadata): void {
    const key = this.getRouteKey(metadata.target, metadata.propertyKey);
    this.graphqlFields.set(key, metadata);
  }

  /**
   * Get all registered GraphQL resolvers
   */
  getGraphQLResolvers(): GraphQLResolverMetadata[] {
    return Array.from(this.graphqlResolvers.values());
  }

  /**
   * Get GraphQL resolver metadata for a specific target
   */
  getGraphQLResolver(target: Class): GraphQLResolverMetadata | undefined {
    return this.graphqlResolvers.get(target);
  }

  /**
   * Get all GraphQL fields
   */
  getGraphQLFields(): GraphQLFieldMetadata[] {
    return Array.from(this.graphqlFields.values());
  }

  /**
   * Get GraphQL fields for a specific resolver
   */
  getGraphQLFieldsByResolver(target: Class): GraphQLFieldMetadata[] {
    return Array.from(this.graphqlFields.values()).filter(
      field => field.target === target
    );
  }

  /**
   * Clear all metadata (useful for testing)
   */
  clear(): void {
    this.routes.clear();
    this.controllers.clear();
    this.routesByController.clear();
    this.websockets.clear();
    this.graphqlResolvers.clear();
    this.graphqlFields.clear();
  }

  /**
   * Generate a unique key for a route
   */
  private getRouteKey(target: Class, propertyKey: string): string {
    return `${target.name}:${propertyKey}`;
  }

  // ============================================================================
  // Static methods for decorator usage
  // ============================================================================

  /**
   * Define route metadata using reflect-metadata (used by decorators)
   */
  static defineRoute(
    target: any,
    propertyKey: string,
    metadata: Partial<RouteMetadata>
  ): void {
    const existingMetadata = this.getRouteMetadata(target, propertyKey);
    
    const mergedMetadata: Partial<RouteMetadata> = {
      ...existingMetadata,
      ...metadata,
      target: target.constructor,
      propertyKey,
      // Merge arrays instead of replacing
      middleware: [
        ...(existingMetadata?.middleware || []),
        ...(metadata.middleware || [])
      ],
      parameters: metadata.parameters || existingMetadata?.parameters || [],
      dependencies: metadata.dependencies || existingMetadata?.dependencies || [],
      responses: metadata.responses || existingMetadata?.responses || []
    };

    Reflect.defineMetadata(
      ROUTE_METADATA_KEY,
      mergedMetadata,
      target,
      propertyKey
    );
  }

  /**
   * Define parameter metadata (used by parameter decorators)
   */
  static defineParameter(
    target: any,
    propertyKey: string,
    index: number,
    metadata: ParameterMetadata
  ): void {
    const existingParams = this.getParameterMetadata(target, propertyKey) || [];
    
    // Update or add parameter at the specified index
    existingParams[index] = metadata;

    Reflect.defineMetadata(
      PARAMETER_METADATA_KEY,
      existingParams,
      target,
      propertyKey
    );

    // Also update the route metadata to include this parameter
    const routeMetadata = this.getRouteMetadata(target, propertyKey);
    this.defineRoute(target, propertyKey, {
      ...routeMetadata,
      parameters: existingParams
    });
  }

  /**
   * Define dependency metadata (used by @Depends decorator)
   */
  static defineDependency(
    target: any,
    propertyKey: string,
    index: number,
    metadata: DependencyMetadata
  ): void {
    const existingDeps = this.getDependencyMetadata(target, propertyKey) || [];
    
    // Update or add dependency at the specified index
    existingDeps[index] = metadata;

    Reflect.defineMetadata(
      DEPENDENCY_METADATA_KEY,
      existingDeps,
      target,
      propertyKey
    );

    // Also update the route metadata to include this dependency
    const routeMetadata = this.getRouteMetadata(target, propertyKey);
    this.defineRoute(target, propertyKey, {
      ...routeMetadata,
      dependencies: existingDeps
    });
  }

  /**
   * Define controller metadata (used by @Controller decorator)
   */
  static defineController(target: any, metadata: ControllerMetadata): void {
    Reflect.defineMetadata(CONTROLLER_METADATA_KEY, metadata, target);
  }

  /**
   * Get route metadata from reflect-metadata
   */
  static getRouteMetadata(target: any, propertyKey: string): Partial<RouteMetadata> | undefined {
    return Reflect.getMetadata(ROUTE_METADATA_KEY, target, propertyKey);
  }

  /**
   * Get parameter metadata from reflect-metadata
   */
  static getParameterMetadata(target: any, propertyKey: string): ParameterMetadata[] | undefined {
    return Reflect.getMetadata(PARAMETER_METADATA_KEY, target, propertyKey);
  }

  /**
   * Get dependency metadata from reflect-metadata
   */
  static getDependencyMetadata(target: any, propertyKey: string): DependencyMetadata[] | undefined {
    return Reflect.getMetadata(DEPENDENCY_METADATA_KEY, target, propertyKey);
  }

  /**
   * Get controller metadata from reflect-metadata
   */
  static getControllerMetadata(target: any): ControllerMetadata | undefined {
    return Reflect.getMetadata(CONTROLLER_METADATA_KEY, target);
  }

  /**
   * Check if a class has controller metadata
   */
  static hasControllerMetadata(target: any): boolean {
    return Reflect.hasMetadata(CONTROLLER_METADATA_KEY, target);
  }

  /**
   * Check if a method has route metadata
   */
  static hasRouteMetadata(target: any, propertyKey: string): boolean {
    return Reflect.hasMetadata(ROUTE_METADATA_KEY, target, propertyKey);
  }

  /**
   * Get all route methods from a controller class
   */
  static getRouteMethods(target: Class): string[] {
    const prototype = target.prototype;
    const methods: string[] = [];

    // Get all property names from the prototype
    const propertyNames = Object.getOwnPropertyNames(prototype);

    for (const propertyName of propertyNames) {
      if (propertyName === 'constructor') continue;
      
      if (this.hasRouteMetadata(prototype, propertyName)) {
        methods.push(propertyName);
      }
    }

    return methods;
  }

  /**
   * Define WebSocket metadata (used by @WebSocket decorator)
   */
  static defineWebSocket(target: any, metadata: Partial<WebSocketMetadata>): void {
    const existingMetadata = this.getWebSocketMetadata(target);
    
    const mergedMetadata: Partial<WebSocketMetadata> = {
      ...existingMetadata,
      ...metadata,
      target: target
    };

    Reflect.defineMetadata(WEBSOCKET_METADATA_KEY, mergedMetadata, target);
  }

  /**
   * Define WebSocket handler metadata (used by @OnConnect, @OnMessage, @OnDisconnect)
   */
  static defineWebSocketHandler(
    target: any,
    propertyKey: string,
    metadata: WebSocketHandlerMetadata
  ): void {
    // Get existing WebSocket metadata
    const wsMetadata = this.getWebSocketMetadata(target.constructor) || {};

    // Update the appropriate handler
    switch (metadata.type) {
      case 'connect':
        wsMetadata.onConnect = propertyKey;
        break;
      case 'message':
        wsMetadata.onMessage = propertyKey;
        wsMetadata.messageSchema = metadata.schema;
        break;
      case 'disconnect':
        wsMetadata.onDisconnect = propertyKey;
        break;
    }

    // Save updated metadata
    this.defineWebSocket(target.constructor, wsMetadata);

    // Also store handler-specific metadata
    Reflect.defineMetadata(
      WEBSOCKET_HANDLER_METADATA_KEY,
      metadata,
      target,
      propertyKey
    );
  }

  /**
   * Get WebSocket metadata from reflect-metadata
   */
  static getWebSocketMetadata(target: any): Partial<WebSocketMetadata> | undefined {
    return Reflect.getMetadata(WEBSOCKET_METADATA_KEY, target);
  }

  /**
   * Get WebSocket handler metadata from reflect-metadata
   */
  static getWebSocketHandlerMetadata(target: any, propertyKey: string): WebSocketHandlerMetadata | undefined {
    return Reflect.getMetadata(WEBSOCKET_HANDLER_METADATA_KEY, target, propertyKey);
  }

  /**
   * Check if a class has WebSocket metadata
   */
  static hasWebSocketMetadata(target: any): boolean {
    return Reflect.hasMetadata(WEBSOCKET_METADATA_KEY, target);
  }

  /**
   * Define GraphQL resolver metadata (used by @Resolver decorator)
   */
  static defineGraphQLResolver(target: any, metadata: GraphQLResolverMetadata): void {
    Reflect.defineMetadata(GRAPHQL_RESOLVER_KEY, metadata, target);
  }

  /**
   * Define GraphQL field metadata (used by @Query, @Mutation, @Subscription decorators)
   */
  static defineGraphQLField(
    target: any,
    propertyKey: string,
    metadata: GraphQLFieldMetadata
  ): void {
    // Store field metadata on the method
    Reflect.defineMetadata(GRAPHQL_FIELD_KEY, metadata, target, propertyKey);

    // Also maintain a list of all fields on the class
    const existingFields = this.getGraphQLFieldsMetadata(target.constructor) || [];
    existingFields.push(metadata);
    Reflect.defineMetadata(GRAPHQL_FIELD_KEY, existingFields, target.constructor);
  }

  /**
   * Get GraphQL resolver metadata from reflect-metadata
   */
  static getGraphQLResolverMetadata(target: any): GraphQLResolverMetadata | undefined {
    return Reflect.getMetadata(GRAPHQL_RESOLVER_KEY, target);
  }

  /**
   * Get all GraphQL fields metadata from a resolver class
   */
  static getGraphQLFieldsMetadata(target: any): GraphQLFieldMetadata[] {
    return Reflect.getMetadata(GRAPHQL_FIELD_KEY, target) || [];
  }

  /**
   * Get GraphQL field metadata from a specific method
   */
  static getGraphQLFieldMetadata(target: any, propertyKey: string): GraphQLFieldMetadata | undefined {
    return Reflect.getMetadata(GRAPHQL_FIELD_KEY, target, propertyKey);
  }

  /**
   * Check if a class has GraphQL resolver metadata
   */
  static hasGraphQLResolverMetadata(target: any): boolean {
    return Reflect.hasMetadata(GRAPHQL_RESOLVER_KEY, target);
  }

  /**
   * Check if a method has GraphQL field metadata
   */
  static hasGraphQLFieldMetadata(target: any, propertyKey: string): boolean {
    return Reflect.hasMetadata(GRAPHQL_FIELD_KEY, target, propertyKey);
  }
}
