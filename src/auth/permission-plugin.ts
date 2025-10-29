import { Plugin } from '../core/plugin.js';
import { VeloceTS } from '../core/application.js';
import { 
  PermissionManager, 
  OwnershipPolicy, 
  TeamMembershipPolicy, 
  PublicResourcePolicy,
  ResourcePermission,
  Permission
} from './permissions.js';
import { createPermissionMiddleware, PermissionGuard } from './permission-decorators.js';
import { Context } from 'hono';
import { z } from 'zod';

export interface PermissionPluginConfig {
  permissionManager?: PermissionManager;
  enableDefaultPolicies?: boolean;
  routes?: {
    permissions?: string;
    grant?: string;
    revoke?: string;
    check?: string;
  };
  enableManagementRoutes?: boolean;
}

export class PermissionPlugin implements Plugin {
  name = 'permissions';
  version = '1.0.0';
  dependencies = ['auth']; // Depends on auth plugin

  private permissionManager: PermissionManager;
  private guard: PermissionGuard;

  constructor(private config: PermissionPluginConfig = {}) {
    this.permissionManager = config.permissionManager || new PermissionManager();
    
    // Add default policies if enabled
    if (config.enableDefaultPolicies !== false) {
      this.permissionManager.definePolicy('ownership', new OwnershipPolicy());
      this.permissionManager.definePolicy('team-membership', new TeamMembershipPolicy());
      this.permissionManager.definePolicy('public-resource', new PublicResourcePolicy());
    }

    this.guard = new PermissionGuard(this.permissionManager);
  }

  async install(app: VeloceTS): Promise<void> {
    // Add permission middleware globally
    const permissionMiddleware = createPermissionMiddleware(this.permissionManager);
    app.use(permissionMiddleware);

    // Add permission manager to DI container
    app.getContainer().register(PermissionManager, {
      factory: () => this.permissionManager,
      scope: 'singleton'
    });

    // Add permission guard to DI container
    app.getContainer().register(PermissionGuard, {
      factory: () => this.guard,
      scope: 'singleton'
    });

    // Extend router compiler to handle permission metadata
    this.extendRouterCompiler(app);

    // Add management routes if enabled
    if (this.config.enableManagementRoutes !== false) {
      this.addManagementRoutes(app);
    }
  }

  private extendRouterCompiler(app: VeloceTS): void {
    const originalCompile = app.compile.bind(app);
    
    app.compile = async () => {
      // First compile normally
      await originalCompile();

      // Then add permission checks to routes that need them
      const routes = app.getMetadata().getRoutes();
      
      for (const route of routes) {
        if (route.resourcePermission) {
          this.addPermissionGuards(app, route);
        }
      }
    };
  }

  private addPermissionGuards(app: VeloceTS, route: any): void {
    // This would add permission guard middleware before the route handler
    // For now, we'll handle it in the parameter extraction phase
  }

  private addManagementRoutes(app: VeloceTS): void {
    const routes = this.config.routes || {};

    // Grant permission to user
    app.post(routes.grant || '/permissions/grant', {
      handler: async (c: Context) => {
        const body = await c.req.json();
        const { userId, resource, resourceId, permissions, expiresAt } = body;

        const resourcePermission: ResourcePermission = {
          userId,
          resource,
          resourceId,
          permissions,
          grantedBy: 'system', // In real app, get from current user
          grantedAt: new Date(),
          expiresAt: expiresAt ? new Date(expiresAt) : undefined
        };

        this.permissionManager.grantPermission(resourcePermission);

        return c.json({
          success: true,
          message: 'Permission granted successfully',
          permission: resourcePermission
        });
      },
      schema: {
        body: z.object({
          userId: z.string(),
          resource: z.string(),
          resourceId: z.string().optional(),
          permissions: z.array(z.object({
            action: z.string(),
            resource: z.string(),
            conditions: z.array(z.any()).optional(),
            attributes: z.array(z.string()).optional()
          })),
          expiresAt: z.string().optional()
        })
      }
    });

    // Revoke permission from user
    app.delete(routes.revoke || '/permissions/revoke', {
      handler: async (c: Context) => {
        const body = await c.req.json();
        const { userId, resource, resourceId } = body;

        this.permissionManager.revokePermission(userId, resource, resourceId);

        return c.json({
          success: true,
          message: 'Permission revoked successfully'
        });
      },
      schema: {
        body: z.object({
          userId: z.string(),
          resource: z.string(),
          resourceId: z.string().optional()
        })
      }
    });

    // Check user permission
    app.post(routes.check || '/permissions/check', {
      handler: async (c: Context) => {
        const body = await c.req.json();
        const { userId, action, resource, resourceId, attributes } = body;

        // Create a mock context for permission checking
        const context = {
          user: { id: userId },
          resource: resourceId ? { id: resourceId } : undefined,
          action,
          attributes
        };

        const hasPermission = this.permissionManager.hasPermission(context);

        return c.json({
          success: true,
          hasPermission,
          context: {
            userId,
            action,
            resource,
            resourceId,
            attributes
          }
        });
      },
      schema: {
        body: z.object({
          userId: z.string(),
          action: z.string(),
          resource: z.string(),
          resourceId: z.string().optional(),
          attributes: z.array(z.string()).optional()
        })
      }
    });

    // Get user permissions for a resource
    app.get('/permissions/user/:userId/resource/:resource', {
      handler: (c: Context) => {
        const userId = c.req.param('userId');
        const resource = c.req.param('resource');
        const resourceId = c.req.query('resourceId');

        const permissions = this.permissionManager.getUserPermissions(userId, resource, resourceId);

        return c.json({
          success: true,
          userId,
          resource,
          resourceId,
          permissions
        });
      }
    });

    // Get all resources user has permissions on
    app.get('/permissions/user/:userId/resources', {
      handler: (c: Context) => {
        const userId = c.req.param('userId');
        const resources = this.permissionManager.getUserResources(userId);

        return c.json({
          success: true,
          userId,
          resources
        });
      }
    });

    // Bulk permission check
    app.post('/permissions/bulk-check', {
      handler: async (c: Context) => {
        const body = await c.req.json();
        const { checks } = body;

        const results = checks.map((check: any) => {
          const context = {
            user: { id: check.userId },
            resource: check.resourceId ? { id: check.resourceId } : undefined,
            action: check.action,
            attributes: check.attributes
          };

          const hasPermission = this.permissionManager.hasPermission(context);

          return {
            ...check,
            hasPermission
          };
        });

        return c.json({
          success: true,
          results
        });
      },
      schema: {
        body: z.object({
          checks: z.array(z.object({
            userId: z.string(),
            action: z.string(),
            resource: z.string(),
            resourceId: z.string().optional(),
            attributes: z.array(z.string()).optional()
          }))
        })
      }
    });

    // Filter resources based on permissions
    app.post('/permissions/filter-resources', {
      handler: async (c: Context) => {
        const body = await c.req.json();
        const { userId, action, resources } = body;

        const user = { id: userId };
        const filteredResources = this.permissionManager.filterResources(
          resources, 
          user, 
          action
        );

        return c.json({
          success: true,
          userId,
          action,
          totalResources: resources.length,
          filteredResources: filteredResources.length,
          resources: filteredResources
        });
      },
      schema: {
        body: z.object({
          userId: z.string(),
          action: z.string(),
          resources: z.array(z.any())
        })
      }
    });
  }

  getPermissionManager(): PermissionManager {
    return this.permissionManager;
  }

  getGuard(): PermissionGuard {
    return this.guard;
  }
}