import { MetadataRegistry } from '../core/metadata.js';
import { RBACManager, PermissionMatcher } from './rbac.js';
import { Context } from 'hono';
import { getCurrentUser } from './decorators.js';
import type { TokenPayload } from './jwt-provider.js';
import { AuthorizationException } from './exceptions.js';
import type { RolesConfig, PermissionsConfig, RoleMetadata, PermissionMetadata } from '../types/index.js';


/**
 * @Roles() decorator for role-based access control
 */
export function Roles(roles: string[] | RolesConfig): MethodDecorator & ClassDecorator {
  return (target: any, propertyKey?: string | symbol) => {
    const config: RolesConfig = Array.isArray(roles) 
      ? { roles, requireAll: false, allowInherited: true }
      : { requireAll: false, allowInherited: true, ...roles };

    const metadata: RoleMetadata = { config };

    // On a controller class: the default for every route of the controller.
    // A method-level @Roles replaces it; @Public() opts a route out.
    if (propertyKey === undefined) {
      MetadataRegistry.defineClassAccess(target, 'roles', metadata);
      return;
    }

    MetadataRegistry.defineRoles(target, propertyKey as string, metadata);
  };
}

/**
 * @Permissions() decorator for permission-based access control
 */
export function Permissions(permissions: string[] | PermissionsConfig): MethodDecorator & ClassDecorator {
  return (target: any, propertyKey?: string | symbol) => {
    const config: PermissionsConfig = Array.isArray(permissions)
      ? { permissions, requireAll: false }
      : { requireAll: false, ...permissions };

    const metadata: PermissionMetadata = { config };

    if (propertyKey === undefined) {
      MetadataRegistry.defineClassAccess(target, 'permissions', metadata);
      return;
    }

    MetadataRegistry.definePermissions(target, propertyKey as string, metadata);
  };
}

/**
 * @RequireRole() decorator - shorthand for single role requirement
 */
export function RequireRole(role: string): MethodDecorator & ClassDecorator {
  return Roles([role]);
}

/**
 * @RequirePermission() decorator - shorthand for single permission requirement
 */
export function RequirePermission(permission: string): MethodDecorator & ClassDecorator {
  return Permissions([permission]);
}

/**
 * @AdminOnly() decorator - shorthand for admin role requirement
 */
export function AdminOnly(): MethodDecorator & ClassDecorator {
  return RequireRole('admin');
}

/**
 * @SuperAdminOnly() decorator - shorthand for super-admin role requirement
 */
export function SuperAdminOnly(): MethodDecorator & ClassDecorator {
  return RequireRole('super-admin');
}

/**
 * @MinimumRole() decorator - requires minimum role level
 */
export function MinimumRole(roleName: string): MethodDecorator & ClassDecorator {
  return (target: any, propertyKey?: string | symbol) => {
    if (propertyKey === undefined) {
      MetadataRegistry.defineClassAccess(target, 'minimumRole', { roleName });
      return;
    }
    MetadataRegistry.defineMinimumRole(target, propertyKey as string, { roleName });
  };
}

/**
 * Roles in effect for the current request: the ones produced by
 * `RBACPluginConfig.resolveRoles` when it is configured, otherwise the roles
 * carried by the token.
 */
function effectiveUserRoles(c: Context): string[] {
  const resolved = c.get('rbac.roles');
  if (Array.isArray(resolved)) return resolved;
  return getCurrentUser(c)?.roles || [];
}

/**
 * Create RBAC middleware
 */
export function createRBACMiddleware(rbac: RBACManager) {
  return async (c: Context, next: () => Promise<void>) => {
    // Store RBAC manager in context for use by guards
    c.set('rbac', rbac);
    await next();
  };
}

/**
 * RBAC Guard functions
 */
export class RBACGuard {
  constructor(
    private rbac: RBACManager,
    private resolveRoles?: (c: Context, user: TokenPayload) => string[] | Promise<string[]>
  ) {}

  /**
   * Run the `resolveRoles` hook (when configured) and store its result in the
   * context as `rbac.roles`, where every check below — and `getUserRoles(c)` —
   * reads it. Call once per request, after authentication.
   */
  async resolveRequestRoles(c: Context, user: TokenPayload): Promise<void> {
    if (!this.resolveRoles) return;
    const resolved = await this.resolveRoles(c, user);
    c.set('rbac.roles', Array.isArray(resolved) ? resolved : []);
  }

  /**
   * Check if user has required roles
   */
  checkRoles(c: Context, config: RolesConfig): void {
    const user = getCurrentUser(c);
    if (!user) {
      throw new AuthorizationException('Authentication required for role check');
    }

    const userRoles = effectiveUserRoles(c);
    
    // Get effective roles if inheritance is allowed
    const effectiveRoles = config.allowInherited 
      ? this.rbac.getEffectiveRoles(userRoles)
      : userRoles;

    let hasAccess: boolean;

    if (config.requireAll) {
      // User must have ALL required roles
      hasAccess = config.roles.every(role => effectiveRoles.includes(role));
    } else {
      // User must have ANY of the required roles
      hasAccess = config.roles.some(role => effectiveRoles.includes(role));
    }

    if (!hasAccess) {
      const requirement = config.requireAll ? 'all' : 'any';
      throw new AuthorizationException(
        `Access denied. Required ${requirement} of roles: ${config.roles.join(', ')}`
      );
    }
  }

  /**
   * Check if user has required permissions
   */
  checkPermissions(c: Context, config: PermissionsConfig): void {
    const user = getCurrentUser(c);
    if (!user) {
      throw new AuthorizationException('Authentication required for permission check');
    }

    const userRoles = effectiveUserRoles(c);
    
    // Get all permissions from user roles
    const userPermissions = new Set<string>();
    for (const role of userRoles) {
      const rolePermissions = this.rbac.getRolePermissions(role);
      rolePermissions.forEach(permission => userPermissions.add(permission));
    }

    const userPermissionsList = Array.from(userPermissions);
    let hasAccess: boolean;

    if (config.requireAll) {
      // User must have ALL required permissions
      hasAccess = config.permissions.every(permission => 
        PermissionMatcher.hasPermission(userPermissionsList, permission)
      );
    } else {
      // User must have ANY of the required permissions
      hasAccess = config.permissions.some(permission => 
        PermissionMatcher.hasPermission(userPermissionsList, permission)
      );
    }

    if (!hasAccess) {
      const requirement = config.requireAll ? 'all' : 'any';
      throw new AuthorizationException(
        `Access denied. Required ${requirement} of permissions: ${config.permissions.join(', ')}`
      );
    }
  }

  /**
   * Check minimum role level
   */
  checkMinimumRole(c: Context, requiredRole: string): void {
    const user = getCurrentUser(c);
    if (!user) {
      throw new AuthorizationException('Authentication required for role level check');
    }

    const userRoles = effectiveUserRoles(c);
    const userHighestLevel = this.rbac.getHighestRoleLevel(userRoles);
    
    const requiredRoleObj = this.rbac.getRole(requiredRole);
    if (!requiredRoleObj) {
      throw new Error(`Required role not found: ${requiredRole}`);
    }

    const requiredLevel = requiredRoleObj.level || 0;

    if (userHighestLevel < requiredLevel) {
      throw new AuthorizationException(
        `Access denied. Minimum role level required: ${requiredRole} (level ${requiredLevel})`
      );
    }
  }
}

/**
 * Helper functions to extract RBAC info from context
 */
export function getRBACManager(c: Context): RBACManager | null {
  return c.get('rbac') || null;
}

export function getUserRoles(c: Context): string[] {
  return effectiveUserRoles(c);
}

export function getUserPermissions(c: Context): string[] {
  const rbac = getRBACManager(c);
  const userRoles = getUserRoles(c);
  
  if (!rbac) {
    return [];
  }

  const permissions = new Set<string>();
  for (const role of userRoles) {
    const rolePermissions = rbac.getRolePermissions(role);
    rolePermissions.forEach(permission => permissions.add(permission));
  }
  
  return Array.from(permissions);
}

export function checkUserRole(c: Context, role: string): boolean {
  const userRoles = getUserRoles(c);
  return userRoles.includes(role);
}

export function checkUserPermission(c: Context, permission: string): boolean {
  const userPermissions = getUserPermissions(c);
  return PermissionMatcher.hasPermission(userPermissions, permission);
}