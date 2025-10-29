import { Plugin } from '../core/plugin.js';
import { VeloceTS } from '../core/application.js';
import { 
  OAuthProvider, 
  OAuthStateManager, 
  PKCEUtils, 
  OAuthCallbackSchema,
  OAuthUser,
  PKCEChallenge
} from './oauth-provider.js';
import { AuthService, UserProvider } from './auth-service.js';
import { Context } from 'hono';
import { z } from 'zod';

export interface OAuthPluginConfig {
  providers: Record<string, OAuthProvider>;
  userProvider?: UserProvider;
  authService?: AuthService;
  routes?: {
    login?: string;
    callback?: string;
  };
  onUserCreated?: (oauthUser: OAuthUser) => Promise<any>;
  onUserLogin?: (oauthUser: OAuthUser, user?: any) => Promise<any>;
}

export class OAuthPlugin implements Plugin {
  name = 'oauth';
  version = '1.0.0';
  dependencies = ['auth']; // Depends on auth plugin

  private stateManager = new OAuthStateManager();
  private pkceStore = new Map<string, PKCEChallenge>();

  constructor(private config: OAuthPluginConfig) {}

  async install(app: VeloceTS): Promise<void> {
    // Add OAuth routes
    this.addOAuthRoutes(app);

    // Extend router compiler to handle OAuth metadata
    this.extendRouterCompiler(app);
  }

  private addOAuthRoutes(app: VeloceTS): void {
    const routes = this.config.routes || {};

    // OAuth login initiation route
    app.get(routes.login || '/auth/oauth/:provider', {
      handler: async (c: Context) => {
        const provider = c.req.param('provider');
        const oauthProvider = this.config.providers[provider];

        if (!oauthProvider) {
          return c.json({ error: 'Unknown OAuth provider' }, 400);
        }

        // Generate state for CSRF protection
        const state = this.stateManager.generateState({ provider });

        let authUrl: string;

        // Generate PKCE challenge if supported
        if (oauthProvider.config.pkce) {
          const pkceChallenge = await PKCEUtils.generatePKCEChallenge();
          this.pkceStore.set(state, pkceChallenge);
          authUrl = oauthProvider.getAuthUrl(state, pkceChallenge.codeChallenge);
        } else {
          authUrl = oauthProvider.getAuthUrl(state);
        }

        return c.json({
          authUrl,
          state,
          provider
        });
      }
    });

    // OAuth callback route
    app.get(routes.callback || '/auth/oauth/:provider/callback', {
      handler: async (c: Context) => {
        const provider = c.req.param('provider');
        const query = c.req.query();

        // Validate callback parameters
        const callbackData = OAuthCallbackSchema.parse(query);

        if (callbackData.error) {
          return c.json({
            error: 'OAuth error',
            description: callbackData.error_description || callbackData.error
          }, 400);
        }

        // Validate state
        const stateValidation = this.stateManager.validateState(callbackData.state);
        if (!stateValidation.valid || stateValidation.data?.provider !== provider) {
          return c.json({ error: 'Invalid state parameter' }, 400);
        }

        const oauthProvider = this.config.providers[provider];
        if (!oauthProvider) {
          return c.json({ error: 'Unknown OAuth provider' }, 400);
        }

        try {
          // Get PKCE verifier if used
          const pkceChallenge = this.pkceStore.get(callbackData.state);
          const codeVerifier = pkceChallenge?.codeVerifier;

          // Exchange code for tokens
          const tokens = await oauthProvider.exchangeCodeForTokens(
            callbackData.code,
            codeVerifier
          );

          // Get user info
          const oauthUser = await oauthProvider.getUserInfo(tokens.accessToken);

          // Clean up PKCE challenge
          if (pkceChallenge) {
            this.pkceStore.delete(callbackData.state);
          }

          // Handle user creation/login
          let user: any = null;
          if (this.config.userProvider) {
            // Try to find existing user by OAuth ID or email
            user = await this.findOrCreateUser(oauthUser);
          }

          // Call user login hook
          if (this.config.onUserLogin) {
            await this.config.onUserLogin(oauthUser, user);
          }

          // Generate JWT tokens if auth service is available
          let jwtTokens: any = null;
          if (this.config.authService && user) {
            const authResult = await this.config.authService.login(user.username, ''); // OAuth users don't have passwords
            jwtTokens = authResult.tokens;
          }

          return c.json({
            success: true,
            user: user || oauthUser,
            oauthTokens: tokens,
            jwtTokens,
            provider
          });

        } catch (error) {
          console.error('OAuth callback error:', error);
          return c.json({
            error: 'OAuth authentication failed',
            message: error instanceof Error ? error.message : 'Unknown error'
          }, 500);
        }
      }
    });

    // OAuth user info route (for testing)
    app.get('/auth/oauth/:provider/user', {
      handler: async (c: Context) => {
        const provider = c.req.param('provider');
        const authHeader = c.req.header('Authorization');

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return c.json({ error: 'Missing OAuth access token' }, 401);
        }

        const accessToken = authHeader.substring(7);
        const oauthProvider = this.config.providers[provider];

        if (!oauthProvider) {
          return c.json({ error: 'Unknown OAuth provider' }, 400);
        }

        try {
          const user = await oauthProvider.getUserInfo(accessToken);
          return c.json({ user });
        } catch (error) {
          return c.json({
            error: 'Failed to get user info',
            message: error instanceof Error ? error.message : 'Unknown error'
          }, 400);
        }
      }
    });
  }

  private async findOrCreateUser(oauthUser: OAuthUser): Promise<any> {
    if (!this.config.userProvider) {
      return null;
    }

    // Try to find user by OAuth ID first
    let user = await this.findUserByOAuthId(oauthUser.id, oauthUser.provider);

    if (!user && oauthUser.email) {
      // Try to find by email
      user = await this.findUserByEmail(oauthUser.email);
    }

    if (!user) {
      // Create new user
      user = await this.createUserFromOAuth(oauthUser);
      
      if (this.config.onUserCreated) {
        await this.config.onUserCreated(oauthUser);
      }
    }

    return user;
  }

  private async findUserByOAuthId(oauthId: string, provider: string): Promise<any> {
    // This would need to be implemented based on your user provider
    // For now, return null (user not found)
    return null;
  }

  private async findUserByEmail(email: string): Promise<any> {
    // This would need to be implemented based on your user provider
    // For now, return null (user not found)
    return null;
  }

  private async createUserFromOAuth(oauthUser: OAuthUser): Promise<any> {
    if (!this.config.userProvider || !('createUser' in this.config.userProvider)) {
      throw new Error('User provider does not support user creation');
    }

    const userData = {
      username: oauthUser.username || oauthUser.email || `${oauthUser.provider}_${oauthUser.id}`,
      email: oauthUser.email,
      password: crypto.randomUUID(), // Random password for OAuth users
      roles: ['user'],
      oauthId: oauthUser.id,
      oauthProvider: oauthUser.provider,
      name: oauthUser.name,
      avatar: oauthUser.avatar
    };

    return await (this.config.userProvider as any).createUser(userData);
  }

  private extendRouterCompiler(app: VeloceTS): void {
    // This would extend the router compiler to handle OAuth metadata
    // Similar to how auth plugin extends it
    // For now, we'll keep it simple
  }

  getProvider(name: string): OAuthProvider | undefined {
    return this.config.providers[name];
  }

  getProviders(): Record<string, OAuthProvider> {
    return { ...this.config.providers };
  }
}