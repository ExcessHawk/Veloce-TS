import { MetadataRegistry } from '../core/metadata.js';
import type { OAuthProvider, OAuthUser } from './oauth-provider.js';
import type { OAuthConfig, OAuthMetadata } from '../types/index.js';


/**
 * @OAuth() decorator for OAuth-based authentication
 */
export function OAuth(config: OAuthConfig): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    const metadata: OAuthMetadata = {
      provider: config.provider,
      config,
    };

    MetadataRegistry.defineOAuth(target, propertyKey as string, metadata);
  };
}

/**
 * @OAuthUser() parameter decorator to inject OAuth user info
 */
export function OAuthUser(): ParameterDecorator {
  return (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    if (propertyKey) {
      MetadataRegistry.defineParameter(target, propertyKey as string, parameterIndex, {
        index: parameterIndex,
        type: 'oauth-user',
        required: true,
      });
    }
  };
}

/**
 * @OAuthToken() parameter decorator to inject OAuth access token
 */
export function OAuthToken(): ParameterDecorator {
  return (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    if (propertyKey) {
      MetadataRegistry.defineParameter(target, propertyKey as string, parameterIndex, {
        index: parameterIndex,
        type: 'oauth-token',
        required: true,
      });
    }
  };
}

/**
 * Extract OAuth user from context
 */
export function getOAuthUser(c: any): OAuthUser | null {
  return c.get('oauth.user') || null;
}

/**
 * Extract OAuth token from context
 */
export function getOAuthToken(c: any): string | null {
  return c.get('oauth.token') || null;
}

/**
 * Check if user is authenticated via OAuth
 */
export function isOAuthAuthenticated(c: any): boolean {
  return c.get('oauth.authenticated') === true;
}

/**
 * Get OAuth provider name
 */
export function getOAuthProvider(c: any): string | null {
  return c.get('oauth.provider') || null;
}