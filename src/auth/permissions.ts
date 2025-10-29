import { z } from 'zod';

export interface Permission {
  action: string;
  resource: string;
  conditions?: PermissionCondition[];
  attributes?: string[]; // Specific attributes that can be accessed
}

export interface PermissionCondition {
  field: string;
  operator: 'eq' | 'ne' | 'in' | 'nin' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'startsWith' | 'endsWith';
  value: any;
}

export interface ResourcePermission {
  userId: string;
  resource: string;
  resourceId?: string; // Specific resource instance
  permissions: Permission[];
  grantedBy?: string;
  grantedAt?: Date;
  expiresAt?: Date;
}

export interface PermissionContext {
  user: any;
  resource?: any;
  action: string;
  attributes?: string[];
  [key: string]: any;
}

export class PermissionManager {
  private resourcePermissions: Map<string, ResourcePermission[]> = new Map();
  private permissionPolicies: Map<string, PermissionPolicy> = new Map();

  /**
   * Grant permission to a user for a resource
   */
  grantPermission(permission: ResourcePermission): void {
    const key = this.getPermissionKey(permission.userId, permission.resource);
    
    if (!this.resourcePermissions.has(key)) {
      this.resourcePermissions.set(key, []);
    }
    
    this.resourcePermissions.get(key)!.push(permission);
  }

  /**
   * Revoke permission from a user for a resource
   */
  revokePermission(userId: string, resource: string, resourceId?: string): void {
    const key = this.getPermissionKey(userId, resource);
    const permissions = this.resourcePermissions.get(key) || [];
    
    const filtered = permissions.filter(p => 
      resourceId ? p.resourceId !== resourceId : true
    );
    
    if (filtered.length === 0) {
      this.resourcePermissions.delete(key);
    } else {
      this.resourcePermissions.set(key, filtered);
    }
  }

  /**
   * Check if user has permission for a specific action on a resource
   */
  hasPermission(context: PermissionContext): boolean {
    const { user, resource, action, attributes } = context;
    
    // Check role-based permissions first (from RBAC)
    if (this.checkRoleBasedPermission(user, action, resource)) {
      return true;
    }

    // Check resource-specific permissions
    const key = this.getPermissionKey(user.id, resource?.constructor?.name || 'unknown');
    const permissions = this.resourcePermissions.get(key) || [];
    
    for (const resourcePerm of permissions) {
      // Check if permission is expired
      if (resourcePerm.expiresAt && resourcePerm.expiresAt < new Date()) {
        continue;
      }

      // Check if this permission applies to the specific resource instance
      if (resourcePerm.resourceId && resource?.id !== resourcePerm.resourceId) {
        continue;
      }

      // Check each permission in the resource permission
      for (const permission of resourcePerm.permissions) {
        if (this.matchesPermission(permission, action, resource, attributes)) {
          // Check conditions if any
          if (permission.conditions && !this.evaluateConditions(permission.conditions, context)) {
            continue;
          }

          return true;
        }
      }
    }

    // Check permission policies
    return this.checkPermissionPolicies(context);
  }

  /**
   * Get all permissions for a user on a resource
   */
  getUserPermissions(userId: string, resourceType: string, resourceId?: string): Permission[] {
    const key = this.getPermissionKey(userId, resourceType);
    const resourcePermissions = this.resourcePermissions.get(key) || [];
    
    const permissions: Permission[] = [];
    
    for (const resourcePerm of resourcePermissions) {
      // Check if permission is expired
      if (resourcePerm.expiresAt && resourcePerm.expiresAt < new Date()) {
        continue;
      }

      // Check if this applies to the specific resource instance
      if (resourceId && resourcePerm.resourceId && resourcePerm.resourceId !== resourceId) {
        continue;
      }

      permissions.push(...resourcePerm.permissions);
    }
    
    return permissions;
  }

  /**
   * Get all resources a user has permissions on
   */
  getUserResources(userId: string): string[] {
    const resources = new Set<string>();
    
    for (const [key, permissions] of this.resourcePermissions.entries()) {
      if (key.startsWith(`${userId}:`)) {
        const resource = key.substring(userId.length + 1);
        resources.add(resource);
      }
    }
    
    return Array.from(resources);
  }

  /**
   * Define a permission policy
   */
  definePolicy(name: string, policy: PermissionPolicy): void {
    this.permissionPolicies.set(name, policy);
  }

  /**
   * Filter resources based on user permissions
   */
  filterResources<T>(
    resources: T[], 
    user: any, 
    action: string,
    getResourceType: (resource: T) => string = (r: any) => r.constructor.name
  ): T[] {
    return resources.filter(resource => {
      const context: PermissionContext = {
        user,
        resource,
        action
      };
      return this.hasPermission(context);
    });
  }

  /**
   * Filter attributes based on user permissions
   */
  filterAttributes(
    resource: any,
    user: any,
    action: string,
    allAttributes: string[]
  ): string[] {
    const context: PermissionContext = {
      user,
      resource,
      action,
      attributes: allAttributes
    };

    if (!this.hasPermission(context)) {
      return [];
    }

    // Get specific attribute permissions
    const resourceType = resource?.constructor?.name || 'unknown';
    const permissions = this.getUserPermissions(user.id, resourceType, resource?.id);
    
    const allowedAttributes = new Set<string>();
    
    for (const permission of permissions) {
      if (permission.action === action || permission.action === '*') {
        if (permission.attributes) {
          permission.attributes.forEach(attr => allowedAttributes.add(attr));
        } else {
          // No specific attributes means all attributes
          allAttributes.forEach(attr => allowedAttributes.add(attr));
        }
      }
    }
    
    return Array.from(allowedAttributes);
  }

  private getPermissionKey(userId: string, resource: string): string {
    return `${userId}:${resource}`;
  }

  private checkRoleBasedPermission(user: any, action: string, resource: any): boolean {
    // This would integrate with the RBAC system
    // For now, return false to rely on resource-specific permissions
    return false;
  }

  private matchesPermission(
    permission: Permission, 
    action: string, 
    resource: any, 
    attributes?: string[]
  ): boolean {
    // Check action match
    if (permission.action !== '*' && permission.action !== action) {
      return false;
    }

    // Check resource match
    const resourceType = resource?.constructor?.name || 'unknown';
    if (permission.resource !== '*' && permission.resource !== resourceType) {
      return false;
    }

    // Check attribute match if specified
    if (attributes && permission.attributes) {
      const hasAllowedAttribute = attributes.some(attr => 
        permission.attributes!.includes(attr) || permission.attributes!.includes('*')
      );
      if (!hasAllowedAttribute) {
        return false;
      }
    }

    return true;
  }

  private evaluateConditions(conditions: PermissionCondition[], context: PermissionContext): boolean {
    return conditions.every(condition => this.evaluateCondition(condition, context));
  }

  private evaluateCondition(condition: PermissionCondition, context: PermissionContext): boolean {
    const fieldValue = this.getFieldValue(condition.field, context);
    
    switch (condition.operator) {
      case 'eq':
        return fieldValue === condition.value;
      case 'ne':
        return fieldValue !== condition.value;
      case 'in':
        return Array.isArray(condition.value) && condition.value.includes(fieldValue);
      case 'nin':
        return Array.isArray(condition.value) && !condition.value.includes(fieldValue);
      case 'gt':
        return fieldValue > condition.value;
      case 'gte':
        return fieldValue >= condition.value;
      case 'lt':
        return fieldValue < condition.value;
      case 'lte':
        return fieldValue <= condition.value;
      case 'contains':
        return String(fieldValue).includes(String(condition.value));
      case 'startsWith':
        return String(fieldValue).startsWith(String(condition.value));
      case 'endsWith':
        return String(fieldValue).endsWith(String(condition.value));
      default:
        return false;
    }
  }

  private getFieldValue(field: string, context: PermissionContext): any {
    const parts = field.split('.');
    let value: any = context;
    
    for (const part of parts) {
      if (value && typeof value === 'object') {
        value = value[part];
      } else {
        return undefined;
      }
    }
    
    return value;
  }

  private checkPermissionPolicies(context: PermissionContext): boolean {
    for (const policy of this.permissionPolicies.values()) {
      if (policy.evaluate(context)) {
        return true;
      }
    }
    return false;
  }
}

export interface PermissionPolicy {
  name: string;
  description?: string;
  evaluate(context: PermissionContext): boolean;
}

// Built-in permission policies
export class OwnershipPolicy implements PermissionPolicy {
  name = 'ownership';
  description = 'User can access resources they own';

  evaluate(context: PermissionContext): boolean {
    const { user, resource } = context;
    
    if (!resource || !user) {
      return false;
    }

    // Check various ownership patterns
    return (
      resource.userId === user.id ||
      resource.ownerId === user.id ||
      resource.createdBy === user.id ||
      resource.owner === user.id
    );
  }
}

export class TeamMembershipPolicy implements PermissionPolicy {
  name = 'team-membership';
  description = 'User can access resources belonging to their team';

  evaluate(context: PermissionContext): boolean {
    const { user, resource } = context;
    
    if (!resource || !user || !user.teamId) {
      return false;
    }

    return resource.teamId === user.teamId;
  }
}

export class PublicResourcePolicy implements PermissionPolicy {
  name = 'public-resource';
  description = 'Anyone can read public resources';

  evaluate(context: PermissionContext): boolean {
    const { resource, action } = context;
    
    if (!resource || action !== 'read') {
      return false;
    }

    return resource.isPublic === true || resource.visibility === 'public';
  }
}

// Validation schemas
export const PermissionSchema = z.object({
  action: z.string(),
  resource: z.string(),
  conditions: z.array(z.object({
    field: z.string(),
    operator: z.enum(['eq', 'ne', 'in', 'nin', 'gt', 'gte', 'lt', 'lte', 'contains', 'startsWith', 'endsWith']),
    value: z.any()
  })).optional(),
  attributes: z.array(z.string()).optional()
});

export const ResourcePermissionSchema = z.object({
  userId: z.string(),
  resource: z.string(),
  resourceId: z.string().optional(),
  permissions: z.array(PermissionSchema),
  grantedBy: z.string().optional(),
  grantedAt: z.date().optional(),
  expiresAt: z.date().optional()
});

export const ResourcePermissionCheckSchema = z.object({
  userId: z.string(),
  action: z.string(),
  resource: z.string(),
  resourceId: z.string().optional(),
  attributes: z.array(z.string()).optional()
});