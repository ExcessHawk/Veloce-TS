import { MetadataRegistry } from '../core/metadata.js';
import { JWTProvider, TokenPayload } from './jwt-provider.js';
import { Context } from 'hono';
import type { AuthConfig, AuthMetadata } from '../types/index.js';


/**
 * @Auth() decorator for protecting routes with JWT authentication
 */
export function Auth(config?: AuthConfig): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    const metadata: AuthMetadata = {
      required: !config?.optional,
      config,
    };

    MetadataRegistry.defineAuth(target, propertyKey as string, metadata);
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
        const payload = jwtProvider.verifyAccessToken(token);
        
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