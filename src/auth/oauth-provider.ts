import { z } from 'zod';

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes?: string[];
  authUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  pkce?: boolean;
}

export interface OAuthProvider {
  name: string;
  config: OAuthConfig;
  getAuthUrl(state: string, codeChallenge?: string): string;
  exchangeCodeForTokens(code: string, codeVerifier?: string): Promise<OAuthTokens>;
  getUserInfo(accessToken: string): Promise<OAuthUser>;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType: string;
  scope?: string;
}

export interface OAuthUser {
  id: string;
  email?: string;
  name?: string;
  username?: string;
  avatar?: string;
  provider: string;
  [key: string]: any;
}

export interface PKCEChallenge {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
}

export class BaseOAuthProvider implements OAuthProvider {
  constructor(
    public name: string,
    public config: OAuthConfig
  ) {}

  getAuthUrl(state: string, codeChallenge?: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      state,
      scope: this.config.scopes?.join(' ') || ''
    });

    if (codeChallenge && this.config.pkce) {
      params.set('code_challenge', codeChallenge);
      params.set('code_challenge_method', 'S256');
    }

    return `${this.config.authUrl}?${params.toString()}`;
  }

  async exchangeCodeForTokens(code: string, codeVerifier?: string): Promise<OAuthTokens> {
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: this.config.redirectUri
    });

    if (codeVerifier && this.config.pkce) {
      body.set('code_verifier', codeVerifier);
    }

    const response = await fetch(this.config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: body.toString()
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    const data = await response.json() as any;
    
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      tokenType: data.token_type || 'Bearer',
      scope: data.scope
    };
  }

  async getUserInfo(accessToken: string): Promise<OAuthUser> {
    const response = await fetch(this.config.userInfoUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get user info: ${error}`);
    }

    const data = await response.json();
    return this.mapUserInfo(data);
  }

  protected mapUserInfo(data: any): OAuthUser {
    // Base implementation - should be overridden by specific providers
    return {
      id: data.id || data.sub,
      email: data.email,
      name: data.name,
      username: data.login || data.preferred_username,
      avatar: data.avatar_url || data.picture,
      provider: this.name,
      ...data
    };
  }
}

// Google OAuth Provider
export class GoogleOAuthProvider extends BaseOAuthProvider {
  constructor(clientId: string, clientSecret: string, redirectUri: string) {
    super('google', {
      clientId,
      clientSecret,
      redirectUri,
      scopes: ['openid', 'profile', 'email'],
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
      pkce: true
    });
  }

  protected mapUserInfo(data: any): OAuthUser {
    return {
      id: data.id,
      email: data.email,
      name: data.name,
      username: data.email,
      avatar: data.picture,
      provider: 'google',
      verified: data.verified_email,
      locale: data.locale,
      raw: data
    };
  }
}

// GitHub OAuth Provider
export class GitHubOAuthProvider extends BaseOAuthProvider {
  constructor(clientId: string, clientSecret: string, redirectUri: string) {
    super('github', {
      clientId,
      clientSecret,
      redirectUri,
      scopes: ['user:email'],
      authUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      userInfoUrl: 'https://api.github.com/user',
      pkce: false // GitHub doesn't support PKCE yet
    });
  }

  protected mapUserInfo(data: any): OAuthUser {
    return {
      id: data.id.toString(),
      email: data.email,
      name: data.name,
      username: data.login,
      avatar: data.avatar_url,
      provider: 'github',
      company: data.company,
      location: data.location,
      bio: data.bio,
      raw: data
    };
  }

  async getUserInfo(accessToken: string): Promise<OAuthUser> {
    // Get basic user info
    const userResponse = await fetch(this.config.userInfoUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'VeloceTS-OAuth'
      }
    });

    if (!userResponse.ok) {
      throw new Error(`Failed to get user info: ${await userResponse.text()}`);
    }

    const userData = await userResponse.json() as any;

    // Get user emails if not public
    if (!userData.email) {
      try {
        const emailResponse = await fetch('https://api.github.com/user/emails', {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'VeloceTS-OAuth'
          }
        });

        if (emailResponse.ok) {
          const emails = await emailResponse.json() as any[];
          const primaryEmail = emails.find((email: any) => email.primary);
          if (primaryEmail) {
            userData.email = primaryEmail.email;
          }
        }
      } catch (error) {
        // Email fetch failed, continue without email
      }
    }

    return this.mapUserInfo(userData);
  }
}

// Microsoft OAuth Provider
export class MicrosoftOAuthProvider extends BaseOAuthProvider {
  constructor(clientId: string, clientSecret: string, redirectUri: string, tenant: string = 'common') {
    super('microsoft', {
      clientId,
      clientSecret,
      redirectUri,
      scopes: ['openid', 'profile', 'email'],
      authUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
      tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
      pkce: true
    });
  }

  protected mapUserInfo(data: any): OAuthUser {
    return {
      id: data.id,
      email: data.mail || data.userPrincipalName,
      name: data.displayName,
      username: data.userPrincipalName,
      avatar: undefined, // Microsoft Graph doesn't provide avatar URL directly
      provider: 'microsoft',
      jobTitle: data.jobTitle,
      department: data.department,
      officeLocation: data.officeLocation,
      raw: data
    };
  }
}

// PKCE utilities
export class PKCEUtils {
  static generateCodeVerifier(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return this.base64URLEncode(array);
  }

  static async generateCodeChallenge(codeVerifier: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(codeVerifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return this.base64URLEncode(new Uint8Array(digest));
  }

  static async generatePKCEChallenge(): Promise<PKCEChallenge> {
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = await this.generateCodeChallenge(codeVerifier);
    
    return {
      codeVerifier,
      codeChallenge,
      codeChallengeMethod: 'S256'
    };
  }

  private static base64URLEncode(array: Uint8Array): string {
    const base64 = btoa(String.fromCharCode(...array));
    return base64
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }
}

// OAuth state management
export class OAuthStateManager {
  private states: Map<string, { timestamp: number; data?: any }> = new Map();
  private readonly ttl: number = 10 * 60 * 1000; // 10 minutes

  generateState(data?: any): string {
    const state = crypto.randomUUID();
    this.states.set(state, {
      timestamp: Date.now(),
      data
    });
    
    // Clean up expired states
    this.cleanup();
    
    return state;
  }

  validateState(state: string): { valid: boolean; data?: any } {
    const stateData = this.states.get(state);
    
    if (!stateData) {
      return { valid: false };
    }

    // Check if expired
    if (Date.now() - stateData.timestamp > this.ttl) {
      this.states.delete(state);
      return { valid: false };
    }

    // Remove state after validation (one-time use)
    this.states.delete(state);
    
    return {
      valid: true,
      data: stateData.data
    };
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [state, data] of this.states.entries()) {
      if (now - data.timestamp > this.ttl) {
        this.states.delete(state);
      }
    }
  }
}

// Validation schemas
export const OAuthCallbackSchema = z.object({
  code: z.string(),
  state: z.string(),
  error: z.string().optional(),
  error_description: z.string().optional()
});

export const OAuthTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  expiresIn: z.number().optional(),
  tokenType: z.string(),
  scope: z.string().optional()
});

export const OAuthUserSchema = z.object({
  id: z.string(),
  email: z.string().optional(),
  name: z.string().optional(),
  username: z.string().optional(),
  avatar: z.string().optional(),
  provider: z.string()
}).passthrough();