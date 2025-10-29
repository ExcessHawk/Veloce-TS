// Authentication module exports
export * from './jwt-provider.js';
export * from './auth-service.js';
export * from './decorators.js';
export * from './exceptions.js';
export * from './auth-plugin.js';
export * from './oauth-provider.js';
export * from './oauth-decorators.js';
export * from './oauth-plugin.js';
export * from './rbac.js';
export * from './rbac-decorators.js';
export * from './rbac-plugin.js';
export * from './permissions.js';
export * from './permission-decorators.js';
export * from './permission-plugin.js';
export * from './session.js';
export * from './session-decorators.js';
export * from './session-plugin.js';

// Re-export commonly used types
export type {
  JWTConfig,
  TokenPayload,
  TokenPair
} from './jwt-provider.js';

export type {
  AuthPluginConfig
} from './auth-plugin.js';

export type {
  OAuthConfig,
  OAuthProvider,
  OAuthTokens,
  OAuthUser,
  PKCEChallenge
} from './oauth-provider.js';

export type {
  OAuthPluginConfig
} from './oauth-plugin.js';

export type {
  Role,
  RoleHierarchy
} from './rbac.js';

export type {
  RBACPluginConfig
} from './rbac-plugin.js';

export type {
  Permission,
  PermissionCondition,
  ResourcePermission,
  PermissionContext,
  PermissionPolicy
} from './permissions.js';

export type {
  ResourcePermissionConfig,
  ResourcePermissionMetadata
} from './permission-decorators.js';

export type {
  PermissionPluginConfig
} from './permission-plugin.js';

export type {
  SessionData,
  SessionConfig as SessionManagerConfig,
  SessionStore
} from './session.js';


export type {
  SessionPluginConfig
} from './session-plugin.js';