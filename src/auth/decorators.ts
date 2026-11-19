import { MetadataRegistry } from '../core/metadata.js';
import { JWTProvider, TokenPayload } from './jwt-provider.js';
import { Context } from 'hono';
import type { AuthConfig, AuthMetadata } from '../types/index.js';


/**
 * @Auth() decorator for protecting routes with JWT authentication.
 *
 * On a method it protects that route. On a controller class it protects every
 * route of the controller; a method can still override it with its own
 * `@Auth()` or opt out with `@Public()`.
 */
export function Auth(config?: AuthConfig): MethodDecorator & ClassDecorator {
  return (target: any, propertyKey?: string | symbol) => {
    const metadata: AuthMetadata = {
      required: !config?.optional,
      config,
    };

    if (propertyKey === undefined) {
      MetadataRegistry.defineClassAccess(target, 'auth', metadata);
      return;
    }

    MetadataRegistry.defineAuth(target, propertyKey as string, metadata);
  };
}

/**
 * @Public() marks a route (or a whole controller) as intentionally reachable
 * without credentials.
 *
 * It matters in two situations:
 * - the controller carries a class-level `@Auth()` / `@Roles()` and this one
 *   route must stay open (a login or health endpoint);
 * - `AuthPlugin` denies by default (it does since v4.0.0), so a route with no
 *   access decorator needs a valid token.
 *
 * @example
 * ```ts
 * @Controller('/orders')
 * @Auth()
 * class OrdersController {
 *   @Get('/')            // requires a token (inherited)
 *   list() {}
 *
 *   @Get('/status')
 *   @Public()            // open
 *   status() {}
 * }
 * ```
 */
export function Public(): MethodDecorator & ClassDecorator {
  return (target: any, propertyKey?: string | symbol) => {
    if (propertyKey === undefined) {
      MetadataRegistry.defineClassAccess(target, 'public', true);
      return;
    }
    MetadataRegistry.definePublic(target, propertyKey as string);
  };
}

/**
 * @CurrentUser() parameter decorator to inject authenticated user
 */
export function CurrentUser(): ParameterDecorator {
  return (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    if (propertyKey) {
      MetadataRegistry.defineParameter(target, propertyKey as string, parameterIndex, {
        index: parameterIndex,
        type: 'current-user',
        required: false, // Allow null/undefined when not authenticated
      });
    }
  };
}

/**
 * @Token() parameter decorator to inject raw JWT token
 */
export function Token(): ParameterDecorator {
  return (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    if (propertyKey) {
      MetadataRegistry.defineParameter(target, propertyKey as string, parameterIndex, {
        index: parameterIndex,
        type: 'token',
        required: false, // Allow null/undefined when not authenticated
      });
    }
  };
}

/**
 * Authentication middleware factory
 */
export function createAuthMiddleware(jwtProvider: JWTProvider) {
  return async (c: Context, next: () => Promise<void>) => {
    const authHeader = c.req.header('Authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      c.set('auth.error', 'Missing or invalid Authorization header');
      c.set('auth.authenticated', false);
    } else {
      const token = authHeader.substring(7); // Remove 'Bearer ' prefix

      try {
        const payload = await jwtProvider.verifyAccessToken(token);
        
        // Store auth info in context
        c.set('auth.user', payload);
        c.set('auth.token', token);
        c.set('auth.authenticated', true);
      } catch (error) {
        c.set('auth.error', error instanceof Error ? error.message : 'Authentication failed');
        c.set('auth.authenticated', false);
      }
    }

    await next();
  };
}

/**
 * Extract user from context
 */
export function getCurrentUser(c: Context): TokenPayload | null {
  return c.get('auth.user') || null;
}

/**
 * Extract token from context
 */
export function getToken(c: Context): string | null {
  return c.get('auth.token') || null;
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated(c: Context): boolean {
  return c.get('auth.authenticated') === true;
}

/**
 * Get authentication error
 */
export function getAuthError(c: Context): string | null {
  return c.get('auth.error') || null;
}