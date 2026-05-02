import { Plugin } from '../core/plugin.js';
import { VeloceTS } from '../core/application.js';
import { RBACManager, createDefaultRBAC, Role } from './rbac.js';
import { createRBACMiddleware, RBACGuard } from './rbac-decorators.js';
import { getCurrentUser } from './decorators.js';
import { AuthorizationException } from './exceptions.js';
import { Context } from 'hono';
import type { Middleware } from '../types/index.js';

export interface RBACPluginConfig {
  rbac?: RBACManager;
  roles?: Role[];
  useDefaults?: boolean;
  routes?: {
    roles?: string;
    permissions?: string;
    userRoles?: string;
  };
  enableManagementRoutes?: boolean;
}

export class RBACPlugin implements Plugin {
  name = 'rbac';
  version = '1.0.0';
  dependencies = ['auth']; // Depends on auth plugin

  private rbac: RBACManager;
  private guard: RBACGuard;

  constructor(private config: RBACPluginConfig = {}) {
    // Initialize RBAC manager
    if (config.rbac) {
      this.rbac = config.rbac;
    } else if (config.useDefaults !== false) {
      this.rbac = createDefaultRBAC();
    } else {
      this.rbac = new RBACManager();
    }

    // Add custom roles if provided
    if (config.roles) {
      this.rbac.defineRoles(config.roles);
    }

    this.guard = new RBACGuard(this.rbac);
  }

  async install(app: VeloceTS): Promise<void> {
    // Add RBAC middleware globally
    const rbacMiddleware = createRBACMiddleware(this.rbac);
    app.use(rbacMiddleware);

    // Add RBAC manager to DI container
    app.getContainer().register(RBACManager, {
      factory: () => this.rbac,
      scope: 'singleton'
    });

    // Add RBAC guard to DI container
    app.getContainer().register(RBACGuard, {
      factory: () => this.guard,
      scope: 'singleton'
    });

    // Extend router compiler to handle RBAC metadata
    this.extendRouterCompiler(app);

    // Add management routes if enabled
    if (this.config.enableManagementRoutes !== false) {
      this.addManagementRoutes(app);
    }
  }

  private extendRouterCompiler(app: VeloceTS): void {
    const originalCompile = app.compile.bind(app);

    app.compile = async () => {
      // Inject RBAC middleware into routes BEFORE compiling so Hono sees them
      const routes = app.getMetadata().getRoutes();

      for (const route of routes) {
        if (route.roles || route.permissions || route.minimumRole) {
          const rbacMiddleware = this.buildRBACMiddleware(route);
          app.getMetadata().registerRoute({
            ...route,
            middleware: [rbacMiddleware, ...(route.middleware || [])],
          });
        }
      }

      await originalCompile();
    };
  }

  private buildRBACMiddleware(route: any): Middleware {
    const guard = this.guard;
    const rolesConfig = route.roles?.config;
    const permissionsConfig = route.permissions?.config;
    const minimumRoleConfig = route.minimumRole;

    return async (c: Context, next: () => Promise<void>) => {
      const user = getCurrentUser(c);

      if (!user) {
        throw new AuthorizationException('Authentication required');
      }

      if (rolesConfig) {
        guard.checkRoles(c, rolesConfig);
      }

      if (permissionsConfig) {
        guard.checkPermissions(c, permissionsConfig);
      }

      if (minimumRoleConfig) {
        guard.checkMinimumRole(c, minimumRoleConfig.roleName);
      }

      await next();
    };
  }

  private addManagementRoutes(app: VeloceTS): void {
    const routes = this.config.routes || {};

    // Get all roles
    app.get(routes.roles || '/rbac/roles', {
      handler: (c: Context) => {
        const roles = this.rbac.getAllRoles();
        return c.json({
          success: true,
          roles: roles.map(role => ({
            name: role.name,
            description: role.description,
            permissions: role.permissions,
            inherits: role.inherits,
            level: role.level
          }))
        });
      }
    });

    // Get role details
    app.get('/rbac/roles/:roleName', {
      handler: (c: Context) => {
        const roleName = c.req.param('roleName');
        const role = this.rbac.getRole(roleName);
        
        if (!role) {
          return c.json({ error: 'Role not found' }, 404);
        }

        const permissions = this.rbac.getRolePermissions(roleName);
        const hierarchy = this.rbac.getRoleHierarchy(roleName);

        return c.json({
          success: true,
          role: {
            ...role,
            effectivePermissions: permissions,
            hierarchy
          }
        });
      }
    });

    // Get all permissions for a role
    app.get('/rbac/roles/:roleName/permissions', {
      handler: (c: Context) => {
        const roleName = c.req.param('roleName');
        
        if (!this.rbac.roleExists(roleName)) {
          return c.json({ error: 'Role not found' }, 404);
        }

        const permissions = this.rbac.getRolePermissions(roleName);
        
        return c.json({
          success: true,
          role: roleName,
          permissions
        });
      }
    });

    // Check if user has permission
    app.post('/rbac/check-permission', {
      handler: async (c: Context) => {
        const body = await c.req.json();
        const { roles, permission } = body;

        if (!Array.isArray(roles) || !permission) {
          return c.json({ error: 'Invalid request body' }, 400);
        }

        const hasPermission = this.rbac.userHasPermission(roles, permission);
        
        return c.json({
          success: true,
          hasPermission,
          roles,
          permission
        });
      }
    });

    // Check if user has roles
    app.post('/rbac/check-roles', {
      handler: async (c: Context) => {
        const body = await c.req.json();
        const { userRoles, requiredRoles, requireAll = false } = body;

        if (!Array.isArray(userRoles) || !Array.isArray(requiredRoles)) {
          return c.json({ error: 'Invalid request body' }, 400);
        }

        const hasRoles = requireAll 
          ? this.rbac.userHasRoles(userRoles, requiredRoles)
          : this.rbac.userHasAnyRole(userRoles, requiredRoles);
        
        return c.json({
          success: true,
          hasRoles,
          userRoles,
          requiredRoles,
          requireAll
        });
      }
    });

    // Get effective roles (including inherited)
    app.post('/rbac/effective-roles', {
      handler: async (c: Context) => {
        const body = await c.req.json();
        const { roles } = body;

        if (!Array.isArray(roles)) {
          return c.json({ error: 'Invalid request body' }, 400);
        }

        const effectiveRoles = this.rbac.getEffectiveRoles(roles);
        
        return c.json({
          success: true,
          inputRoles: roles,
          effectiveRoles
        });
      }
    });

    // Get user permissions from roles
    app.post('/rbac/user-permissions', {
      handler: async (c: Context) => {
        const body = await c.req.json();
        const { roles } = body;

        if (!Array.isArray(roles)) {
          return c.json({ error: 'Invalid request body' }, 400);
        }

        const permissions = new Set<string>();
        for (const role of roles) {
          if (this.rbac.roleExists(role)) {
            const rolePermissions = this.rbac.getRolePermissions(role);
            rolePermissions.forEach(permission => permissions.add(permission));
          }
        }
        
        return c.json({
          success: true,
          roles,
          permissions: Array.from(permissions)
        });
      }
    });
  }

  getRBACManager(): RBACManager {
    return this.rbac;
  }

  getGuard(): RBACGuard {
    return this.guard;
  }
}