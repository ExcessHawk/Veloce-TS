import 'reflect-metadata';
import { describe, it, expect, beforeAll } from 'bun:test';
import { Veloce } from 'veloce-ts';
import {
  AuthPlugin,
  OAuthPlugin,
  BaseOAuthProvider,
  OAuthStateManager,
  PKCEUtils,
  GoogleOAuthProvider,
  GitHubOAuthProvider,
  InMemoryUserProvider
} from 'veloce-ts/auth';

const JWT_CONFIG = { secret: 'test-secret-32chars-minimum-abcd', expiresIn: '1h', refreshExpiresIn: '7d' };

function makeApp(providers: Record<string, any> = {}) {
  const app = new Veloce({ docs: false });
  app.usePlugin(new AuthPlugin({ jwt: JWT_CONFIG, userProvider: new InMemoryUserProvider() }));
  app.usePlugin(new OAuthPlugin({ providers }));
  return app;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockProviderConfig = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  redirectUri: 'http://localhost:3000/auth/oauth/test/callback',
  scopes: ['openid', 'profile', 'email'],
  authUrl: 'https://auth.example.com/oauth/authorize',
  tokenUrl: 'https://auth.example.com/oauth/token',
  userInfoUrl: 'https://auth.example.com/oauth/userinfo'
};

function makeMockProvider(name = 'test') {
  return new BaseOAuthProvider(name, mockProviderConfig);
}

// ── OAuthPlugin construction ──────────────────────────────────────────────────
describe('OAuthPlugin construction', () => {
  it('constructs with valid provider config', () => {
    expect(() => new OAuthPlugin({ providers: { test: makeMockProvider() } })).not.toThrow();
  });

  it('has correct name and version', () => {
    const p = new OAuthPlugin({ providers: {} });
    expect(p.name).toBe('oauth');
    expect(p.version).toBe('1.0.0');
  });

  it('getProvider() returns the registered provider', () => {
    const provider = makeMockProvider('github');
    const p = new OAuthPlugin({ providers: { github: provider } });
    expect(p.getProvider('github')).toBe(provider);
  });

  it('getProvider() returns undefined for unknown provider', () => {
    const p = new OAuthPlugin({ providers: {} });
    expect(p.getProvider('nonexistent')).toBeUndefined();
  });

  it('getProviders() returns all registered providers', () => {
    const g = makeMockProvider('google');
    const gh = makeMockProvider('github');
    const p = new OAuthPlugin({ providers: { google: g, github: gh } });
    const providers = p.getProviders();
    expect(Object.keys(providers)).toContain('google');
    expect(Object.keys(providers)).toContain('github');
  });

  it('installs without throwing (with required auth plugin)', async () => {
    const app = makeApp({ test: makeMockProvider() });
    await expect(app.compile()).resolves.toBeUndefined();
  });
});

// ── OAuthPlugin routes ────────────────────────────────────────────────────────
describe('OAuthPlugin HTTP routes', () => {
  let hono: any;

  beforeAll(async () => {
    const app = makeApp({ test: makeMockProvider() });
    await app.compile();
    hono = app.getHono();
  });

  it('GET /auth/oauth/:provider with known provider → 200 and authUrl', async () => {
    const res = await hono.fetch(new Request('http://localhost/auth/oauth/test'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.authUrl).toBe('string');
    expect(body.authUrl).toContain('https://auth.example.com/oauth/authorize');
    expect(body.provider).toBe('test');
    expect(typeof body.state).toBe('string');
  });

  it('GET /auth/oauth/:provider with unknown provider → 400', async () => {
    const res = await hono.fetch(new Request('http://localhost/auth/oauth/unknown-provider'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/unknown.*provider/i);
  });

  it('GET /auth/oauth/:provider/callback with missing code → 400 (Zod parse fails)', async () => {
    const res = await hono.fetch(new Request('http://localhost/auth/oauth/test/callback'));
    // Missing `code` param → OAuthCallbackSchema.parse throws → Hono returns 4xx or 500
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('GET /auth/oauth/:provider/callback with invalid state → 400', async () => {
    const res = await hono.fetch(
      new Request('http://localhost/auth/oauth/test/callback?code=abc&state=invalid-state')
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid state/i);
  });

  it('GET /auth/oauth/:provider/user without Bearer token → 401', async () => {
    const res = await hono.fetch(new Request('http://localhost/auth/oauth/test/user'));
    expect(res.status).toBe(401);
  });

  it('GET /auth/oauth/unknown/user with token → 400 unknown provider', async () => {
    const res = await hono.fetch(new Request('http://localhost/auth/oauth/unknown/user', {
      headers: { Authorization: 'Bearer fake-token' }
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/unknown.*provider/i);
  });
});

// ── BaseOAuthProvider ─────────────────────────────────────────────────────────
describe('BaseOAuthProvider', () => {
  it('constructs with name and config', () => {
    const p = makeMockProvider('myapp');
    expect(p.name).toBe('myapp');
    expect(p.config.clientId).toBe('test-client-id');
  });

  it('getAuthUrl() returns URL with required query params', () => {
    const p = makeMockProvider();
    const url = p.getAuthUrl('test-state');
    expect(url).toContain('client_id=test-client-id');
    expect(url).toContain('state=test-state');
    expect(url).toContain('response_type=code');
    expect(url).toContain('https://auth.example.com/oauth/authorize');
  });

  it('getAuthUrl() includes PKCE params when pkce=true', () => {
    const provider = new BaseOAuthProvider('pkce', { ...mockProviderConfig, pkce: true });
    const url = provider.getAuthUrl('my-state', 'my-challenge');
    expect(url).toContain('code_challenge=my-challenge');
    expect(url).toContain('code_challenge_method=S256');
  });

  it('getAuthUrl() excludes PKCE params when pkce=false', () => {
    const p = makeMockProvider();
    const url = p.getAuthUrl('state', 'challenge');
    expect(url).not.toContain('code_challenge');
  });
});

// ── GoogleOAuthProvider / GitHubOAuthProvider ─────────────────────────────────
describe('GoogleOAuthProvider', () => {
  it('constructs with client credentials', () => {
    const p = new GoogleOAuthProvider({
      clientId: 'g-client',
      clientSecret: 'g-secret',
      redirectUri: 'http://localhost/callback'
    });
    expect(p.name).toBe('google');
    expect(p.config.authUrl).toContain('google');
  });

  it('getAuthUrl() contains google accounts domain', () => {
    const p = new GoogleOAuthProvider({
      clientId: 'g-client',
      clientSecret: 'g-secret',
      redirectUri: 'http://localhost/callback'
    });
    const url = p.getAuthUrl('state-abc');
    expect(url).toContain('accounts.google.com');
    expect(url).toContain('state=state-abc');
  });
});

describe('GitHubOAuthProvider', () => {
  it('constructs with client credentials', () => {
    const p = new GitHubOAuthProvider({
      clientId: 'gh-client',
      clientSecret: 'gh-secret',
      redirectUri: 'http://localhost/callback'
    });
    expect(p.name).toBe('github');
    expect(p.config.authUrl).toContain('github');
  });
});

// ── OAuthStateManager ─────────────────────────────────────────────────────────
describe('OAuthStateManager', () => {
  it('generateState() returns a non-empty string', () => {
    const sm = new OAuthStateManager();
    const state = sm.generateState();
    expect(typeof state).toBe('string');
    expect(state.length).toBeGreaterThan(0);
  });

  it('generateState() returns unique values', () => {
    const sm = new OAuthStateManager();
    const s1 = sm.generateState();
    const s2 = sm.generateState();
    expect(s1).not.toBe(s2);
  });

  it('validateState() returns valid=true for freshly generated state', () => {
    const sm = new OAuthStateManager();
    const state = sm.generateState({ provider: 'google' });
    const result = sm.validateState(state);
    expect(result.valid).toBe(true);
    expect(result.data?.provider).toBe('google');
  });

  it('validateState() returns valid=false for unknown state', () => {
    const sm = new OAuthStateManager();
    const result = sm.validateState('totally-made-up-state');
    expect(result.valid).toBe(false);
  });

  it('validateState() is one-time — second call returns valid=false', () => {
    const sm = new OAuthStateManager();
    const state = sm.generateState();
    sm.validateState(state); // consume
    const result = sm.validateState(state);
    expect(result.valid).toBe(false);
  });
});

// ── PKCEUtils ─────────────────────────────────────────────────────────────────
describe('PKCEUtils', () => {
  it('generateCodeVerifier() returns a string', () => {
    const verifier = PKCEUtils.generateCodeVerifier();
    expect(typeof verifier).toBe('string');
    expect(verifier.length).toBeGreaterThan(0);
  });

  it('generateCodeVerifier() returns URL-safe characters only', () => {
    const verifier = PKCEUtils.generateCodeVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it('generatePKCEChallenge() returns codeVerifier, codeChallenge, codeChallengeMethod', async () => {
    const challenge = await PKCEUtils.generatePKCEChallenge();
    expect(typeof challenge.codeVerifier).toBe('string');
    expect(typeof challenge.codeChallenge).toBe('string');
    expect(challenge.codeChallengeMethod).toBe('S256');
  });

  it('generatePKCEChallenge() verifier and challenge are different strings', async () => {
    const challenge = await PKCEUtils.generatePKCEChallenge();
    expect(challenge.codeVerifier).not.toBe(challenge.codeChallenge);
  });
});
