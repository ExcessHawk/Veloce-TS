import { z } from 'zod';

export interface Role {
  name: string;
  description?: string;
  permissions: string[];
  inherits?: string[]; // Roles that this role inherits from
  level?: number; // Hierarchical level (higher = more privileged)
}

export interface RoleHierarchy {
  roles: Map<string, Role>;
  hierarchy: Map<string, string[]>; // role -> parent roles
}

export class RBACManager {
  private roles: Map<string, Role> = new Map();
  private hierarchy: Map<string, string[]> = new Map();
  private compiledPermissions: Map<string, Set<string>> = new Map();

  /**
   * Define a role with its permissions and inheritance
   */
  defineRole(role: Role): void {
    this.roles.set(role.name, role);
    
    // Build hierarchy
    if (role.inherits && role.inherits.length > 0) {
      this.hierarchy.set(role.name, role.inherits);
    }

    // Clear compiled permissions cache
    this.compiledPermissions.clear();
  }

  /**
   * Define multiple roles at once
   */
  defineRoles(roles: Role[]): void {
    for (const role of roles) {
      this.defineRole(role);
    }
  }

  /**
   * Get all permissions for a role (including inherited)
   */
  getRolePermissions(roleName: string): string[] {
    if (this.compiledPermissions.has(roleName)) {
      return Array.from(this.compiledPermissions.get(roleName)!);
    }

    const permissions = new Set<string>();
    this.collectPermissions(roleName, permissions, new Set());
    
    this.compiledPermissions.set(roleName, permissions);
    return Array.from(permissions);
  }

  /**
   * Check if a role has a specific permission
   */
  roleHasPermission(roleName: string, permission: string): boolean {
    const permissions = this.getRolePermissions(roleName);
    return permissions.includes(permission);
  }

  /**
   * Check if user with roles has a specific permission
   */
  userHasPermission(userRoles: string[], permission: string): boolean {
    for (const role of userRoles) {
      if (this.roleHasPermission(role, permission)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if user has all required roles
   */
  userHasRoles(userRoles: string[], requiredRoles: string[]): boolean {
    return requiredRoles.every(role => userRoles.includes(role));
  }

  /**
   * Check if user has any of the required roles
   */
  userHasAnyRole(userRoles: string[], requiredRoles: string[]): boolean {
    return requiredRoles.some(role => userRoles.includes(role));
  }

  /**
   * Get all roles that have a specific permission
   */
  getRolesWithPermission(permission: string): string[] {
    const rolesWithPermission: string[] = [];
    
    for (const roleName of this.roles.keys()) {
      if (this.roleHasPermission(roleName, permission)) {
        rolesWithPermission.push(roleName);
      }
    }
    
    return rolesWithPermission;
  }

  /**
   * Get role hierarchy (parent roles)
   */
  getRoleHierarchy(roleName: string): string[] {
    const parents: string[] = [];
    this.collectParentRoles(roleName, parents, new Set());
    return parents;
  }

  /**
   * Check if one role inherits from another
   */
  roleInheritsFrom(childRole: string, parentRole: string): boolean {
    const hierarchy = this.getRoleHierarchy(childRole);
    return hierarchy.includes(parentRole);
  }

  /**
   * Get all defined roles
   */
  getAllRoles(): Role[] {
    return Array.from(this.roles.values());
  }

  /**
   * Get role definition
   */
  getRole(roleName: string): Role | undefined {
    return this.roles.get(roleName);
  }

  /**
   * Check if role exists
   */
  roleExists(roleName: string): boolean {
    return this.roles.has(roleName);
  }

  /**
   * Validate role names
   */
  validateRoles(roleNames: string[]): { valid: string[]; invalid: string[] } {
    const valid: string[] = [];
    const invalid: string[] = [];

    for (const roleName of roleNames) {
      if (this.roleExists(roleName)) {
        valid.push(roleName);
      } else {
        invalid.push(roleName);
      }
    }

    return { valid, invalid };
  }

  /**
   * Get effective roles (including inherited roles)
   */
  getEffectiveRoles(userRoles: string[]): string[] {
    const effectiveRoles = new Set<string>();
    
    for (const role of userRoles) {
      effectiveRoles.add(role);
      const hierarchy = this.getRoleHierarchy(role);
      hierarchy.forEach(parentRole => effectiveRoles.add(parentRole));
    }
    
    return Array.from(effectiveRoles);
  }

  /**
   * Compare role levels (for hierarchical comparison)
   */
  compareRoleLevels(role1: string, role2: string): number {
    const r1 = this.getRole(role1);
    const r2 = this.getRole(role2);
    
    const level1 = r1?.level ?? 0;
    const level2 = r2?.level ?? 0;
    
    return level1 - level2;
  }

  /**
   * Get highest role level from user roles
   */
  getHighestRoleLevel(userRoles: string[]): number {
    let highestLevel = 0;
    
    for (const roleName of userRoles) {
      const role = this.getRole(roleName);
      if (role && role.level && role.level > highestLevel) {
        highestLevel = role.level;
      }
    }
    
    return highestLevel;
  }

  private collectPermissions(roleName: string, permissions: Set<string>, visited: Set<string>): void {
    if (visited.has(roleName)) {
      // Circular dependency detected
      throw new Error(`Circular role inheritance detected: ${roleName}`);
    }

    visited.add(roleName);
    
    const role = this.roles.get(roleName);
    if (!role) {
      throw new Error(`Role not found: ${roleName}`);
    }

    // Add direct permissions
    role.permissions.forEach(permission => permissions.add(permission));

    // Add inherited permissions
    const parentRoles = this.hierarchy.get(roleName) || [];
    for (const parentRole of parentRoles) {
      this.collectPermissions(parentRole, permissions, new Set(visited));
    }
  }

  private collectParentRoles(roleName: string, parents: string[], visited: Set<string>): void {
    if (visited.has(roleName)) {
      return; // Avoid infinite recursion
    }

    visited.add(roleName);
    
    const parentRoles = this.hierarchy.get(roleName) || [];
    for (const parentRole of parentRoles) {
      parents.push(parentRole);
      this.collectParentRoles(parentRole, parents, visited);
    }
  }
}

// Default RBAC setup with common roles
export function createDefaultRBAC(): RBACManager {
  const rbac = new RBACManager();

  // Define common roles with hierarchy
  rbac.defineRoles([
    {
      name: 'guest',
      description: 'Guest user with minimal permissions',
      permissions: ['read:public'],
      level: 1
    },
    {
      name: 'user',
      description: 'Regular authenticated user',
      permissions: ['read:own', 'write:own', 'read:public'],
      inherits: ['guest'],
      level: 10
    },
    {
      name: 'moderator',
      description: 'Moderator with content management permissions',
      permissions: ['read:all', 'write:all', 'moderate:content'],
      inherits: ['user'],
      level: 50
    },
    {
      name: 'admin',
      description: 'Administrator with full system access',
      permissions: ['*'], // Wildcard for all permissions
      inherits: ['moderator'],
      level: 100
    },
    {
      name: 'super-admin',
      description: 'Super administrator with unrestricted access',
      permissions: ['*', 'system:*'],
      inherits: ['admin'],
      level: 1000
    }
  ]);

  return rbac;
}

// Validation schemas
export const RoleSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  permissions: z.array(z.string()),
  inherits: z.array(z.string()).optional(),
  level: z.number().optional()
});

export const RoleAssignmentSchema = z.object({
  userId: z.string(),
  roles: z.array(z.string())
});

export const PermissionCheckSchema = z.object({
  userId: z.string(),
  permission: z.string()
});

// Permission patterns
export class PermissionMatcher {
  /**
   * Check if a permission matches a pattern (supports wildcards)
   */
  static matches(permission: string, pattern: string): boolean {
    if (pattern === '*') {
      return true; // Wildcard matches everything
    }

    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      return permission.startsWith(prefix);
    }

    return permission === pattern;
  }

  /**
   * Check if user permissions include required permission (with wildcard support)
   */
  static hasPermission(userPermissions: string[], requiredPermission: string): boolean {
    return userPermissions.some(permission => 
      this.matches(requiredPermission, permission)
    );
  }

  /**
   * Filter permissions by pattern
   */
  static filterByPattern(permissions: string[], pattern: string): string[] {
    return permissions.filter(permission => this.matches(permission, pattern));
  }
}