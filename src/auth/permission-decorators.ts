import { MetadataRegistry } from '../core/metadata.js';
import { PermissionManager, PermissionContext } from './permissions.js';
import { Context } from 'hono';
import { getCurrentUser } from './decorators.js';
import { AuthorizationException } from './exceptions.js';

export interface ResourcePermissionConfig {
  action: string;
  resource?: string; // If not provided, inferred from parameter type
  attributes?: string[];
  conditions?: Array<{
    field: string;
    operator: string;
    value: any;
  }>;
}

export interface ResourcePermissionMetadata {
  config: ResourcePermissionConfig;
}

/**
 * @CanAccess() decorator for resource-based permission checking
 */
export function CanAccess(config: ResourcePermissionConfig): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    const metadata: ResourcePermissionMetadata = { config };

    MetadataRegistry.defineResourcePermission(target, propertyKey as string, metadata);
  };
}

/**
 * @CanRead() decorator - shorthand for read permission
 */
export function CanRead(resource?: string, attributes?: string[]): MethodDecorator {
  return CanAccess({ action: 'read', resource, attributes });
}

/**
 * @CanWrite() decorator - shorthand for write permission
 */
export function CanWrite(resource?: string, attributes?: string[]): MethodDecorator {
  return CanAccess({ action: 'write', resource, attributes });
}

/**
 * @CanUpdate() decorator - shorthand for update permission
 */
export function CanUpdate(resource?: string, attributes?: string[]): MethodDecorator {
  return CanAccess({ action: 'update', resource, attributes });
}

/**
 * @CanDelete() decorator - shorthand for delete permission
 */
export function CanDelete(resource?: string): MethodDecorator {
  return CanAccess({ action: 'delete', resource });
}

/**
 * @OwnerOnly() decorator - only resource owner can access
 */
export function OwnerOnly(action: string = 'access'): MethodDecorator {
  return CanAccess({
    action,
    conditions: [
      { field: 'resource.userId', operator: 'eq', value: '{{user.id}}' }
    ]
  });
}

/**
 * @TeamOnly() decorator - only team members can access
 */
export function TeamOnly(action: string = 'access'): MethodDecorator {
  return CanAccess({
    action,
    conditions: [
      { field: 'resource.teamId', operator: 'eq', value: '{{user.teamId}}' }
    ]
  });
}

/**
 * @PublicRead() decorator - allow public read access
 */
export function PublicRead(): MethodDecorator {
  return CanAccess({
    action: 'read',
    conditions: [
      { field: 'resource.isPublic', operator: 'eq', value: true }
    ]
  });
}

/**
 * @FilteredResource() parameter decorator to inject filtered resource
 */
export function FilteredResource(action: string = 'read'): ParameterDecorator {
  return (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    if (propertyKey) {
      MetadataRegistry.defineParameter(target, propertyKey as string, parameterIndex, {
        index: parameterIndex,
        type: 'filtered-resource',
        required: true,
        metadata: { action }
      });
    }
  };
}

/**
 * @FilteredAttributes() parameter decorator to inject filtered attributes
 */
export function FilteredAttributes(action: string = 'read'): ParameterDecorator {
  return (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    if (propertyKey) {
      MetadataRegistry.defineParameter(target, propertyKey as string, parameterIndex, {
        index: parameterIndex,
        type: 'filtered-attributes',
        required: true,
        metadata: { action }
      });
    }
  };
}

/**
 * Create permission middleware
 */
export function createPermissionMiddleware(permissionManager: PermissionManager) {
  return async (c: Context, next: () => Promise<void>) => {
    // Store permission manager in context
    c.set('permissionManager', permissionManager);
    await next();
  };
}

/**
 * Permission Guard class
 */
export class PermissionGuard {
  constructor(private permissionManager: PermissionManager) {}

  /**
   * Check resource permission
   */
  checkResourcePermission(c: Context, config: ResourcePermissionConfig, resource?: any): void {
    const user = getCurrentUser(c);
    if (!user) {
      throw new AuthorizationException('Authentication required for permission check');
    }

    const context: PermissionContext = {
      user,
      resource,
      action: config.action,
      attributes: config.attributes
    };

    // Resolve template values in conditions
    if (config.conditions) {
      context.conditions = config.conditions.map(condition => ({
        ...condition,
        value: this.resolveTemplateValue(condition.value, context)
      }));
    }

    const hasPermission = this.permissionManager.hasPermission(context);

    if (!hasPermission) {
      throw new AuthorizationException(
        `Access denied. Required permission: ${config.action} on ${config.resource || 'resource'}`
      );
    }
  }

  /**
   * Filter resource based on permissions
   */
  filterResource<T>(c: Context, resource: T, action: string): T | null {
    const user = getCurrentUser(c);
    if (!user) {
      return null;
    }

    const context: PermissionContext = {
      user,
      resource,
      action
    };

    const hasPermission = this.permissionManager.hasPermission(context);
    return hasPermission ? resource : null;
  }

  /**
   * Filter multiple resources based on permissions
   */
  filterResources<T>(c: Context, resources: T[], action: string): T[] {
    const user = getCurrentUser(c);
    if (!user) {
      return [];
    }

    return this.permissionManager.filterResources(resources, user, action);
  }

  /**
   * Filter attributes based on permissions
   */
  filterAttributes(c: Context, resource: any, action: string, attributes: string[]): string[] {
    const user = getCurrentUser(c);
    if (!user) {
      return [];
    }

    return this.permissionManager.filterAttributes(resource, user, action, attributes);
  }

  private resolveTemplateValue(value: any, context: PermissionContext): any {
    if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
      const path = value.slice(2, -2);
      return this.getNestedValue(context, path);
    }
    return value;
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }
}

/**
 * Helper functions
 */
export function getPermissionManager(c: Context): PermissionManager | null {
  return c.get('permissionManager') || null;
}

export function checkResourceAccess(
  c: Context, 
  resource: any, 
  action: string, 
  attributes?: string[]
): boolean {
  const permissionManager = getPermissionManager(c);
  const user = getCurrentUser(c);
  
  if (!permissionManager || !user) {
    return false;
  }

  const context: PermissionContext = {
    user,
    resource,
    action,
    attributes
  };

  return permissionManager.hasPermission(context);
}

export function getUserResourcePermissions(
  c: Context, 
  resourceType: string, 
  resourceId?: string
): string[] {
  const permissionManager = getPermissionManager(c);
  const user = getCurrentUser(c);
  
  if (!permissionManager || !user) {
    return [];
  }

  const permissions = permissionManager.getUserPermissions(user.id, resourceType, resourceId);
  return permissions.map(p => p.action);
}

export function canUserAccess(
  c: Context, 
  resource: any, 
  action: string
): boolean {
  return checkResourceAccess(c, resource, action);
}