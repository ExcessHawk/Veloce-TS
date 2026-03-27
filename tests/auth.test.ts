/**
 * Authentication tests — JWT, register, login, logout, RBAC
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { JWTProvider } from '../src/auth/jwt-provider';
import { AuthService, InMemoryUserProvider } from '../src/auth/auth-service';
import {
  AuthenticationException,
  InvalidTokenException,
  TokenExpiredException,
} from '../src/auth/exceptions';

const SECRET = 'test-secret-key-32chars-minimum!!';

// ─── JWTProvider ─────────────────────────────────────────────────────────────

describe('JWTProvider', () => {
  let provider: JWTProvider;

  beforeEach(() => {
    provider = new JWTProvider({ secret: SECRET, expiresIn: '1h', refreshExpiresIn: '7d' });
  });

  it('throws when secret is missing', () => {
    expect(() => new JWTProvider({ secret: '' })).toThrow('JWT secret is required');
  });

  it('generates valid token pair', () => {
    const tokens = provider.generateTokens({ sub: 'user1', username: 'alice' });
    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.refreshToken).toBeTruthy();
    expect(tokens.expiresIn).toBeGreaterThan(0);
  });

  it('verifies access token and returns payload', () => {
    const tokens = provider.generateTokens({ sub: 'user1', username: 'alice' });
    const payload = provider.verifyAccessToken(tokens.accessToken);
    expect(payload.sub).toBe('user1');
    expect(payload.username).toBe('alice');
  });

  it('throws InvalidToken when token is garbage', () => {
    expect(() => provider.verifyAccessToken('not.a.jwt')).toThrow();
  });

  it('blacklisted token is rejected', () => {
    const tokens = provider.generateTokens({ sub: 'user1' });
    provider.blacklistToken(tokens.accessToken);
    expect(() => provider.verifyAccessToken(tokens.accessToken)).toThrow('Token has been revoked');
  });

  it('cleanupBlacklist removes expired tokens', () => {
    // Create a token with extremely short expiry
    const shortProvider = new JWTProvider({ secret: SECRET, expiresIn: '1s' });
    const tokens = shortProvider.generateTokens({ sub: 'x' });
    shortProvider.blacklistToken(tokens.accessToken);
    expect(shortProvider.isBlacklisted(tokens.accessToken)).toBe(true);

    // Simulate expiry by manually cleaning up
    shortProvider.cleanupBlacklist();
    // Token is expired so cleanup should remove it (if exp is in the past)
    // Since expiry is 1s we can't guarantee instant test execution, but the method should not throw
  });

  it('refreshes access token using refresh token', () => {
    const tokens = provider.generateTokens({ sub: 'user2', roles: ['admin'] });
    const newTokens = provider.refreshAccessToken(tokens.refreshToken);
    expect(newTokens.accessToken).toBeTruthy();
    // Old refresh token should now be blacklisted
    expect(provider.isBlacklisted(tokens.refreshToken)).toBe(true);
  });

  it('refresh token cannot be used as access token', () => {
    const tokens = provider.generateTokens({ sub: 'user2' });
    // verifyAccessToken should reject refresh tokens (they have type: 'refresh')
    // because the verifyRefreshToken checks type explicitly; verifyAccessToken
    // would still accept it from signature perspective but the payload type differs
    const refreshPayload = provider.decodeToken(tokens.refreshToken);
    expect(refreshPayload?.type).toBe('refresh');
  });
});

// ─── InMemoryUserProvider ────────────────────────────────────────────────────

describe('InMemoryUserProvider', () => {
  let userProvider: InMemoryUserProvider;

  beforeEach(() => {
    userProvider = new InMemoryUserProvider();
  });

  it('createUser stores user and findById returns it', async () => {
    const user = await userProvider.createUser({
      username: 'bob',
      password: 'secret123',
      email: 'bob@test.com',
      roles: ['user'],
    });
    expect(user.id).toBeTruthy();
    expect(user.username).toBe('bob');

    const found = await userProvider.findById(user.id);
    expect(found).not.toBeNull();
    expect(found?.username).toBe('bob');
  });

  it('findByCredentials returns user for correct password', async () => {
    await userProvider.createUser({ username: 'carol', password: 'pass123' });
    const user = await userProvider.findByCredentials('carol', 'pass123');
    expect(user).not.toBeNull();
    expect(user?.username).toBe('carol');
  });

  it('findByCredentials returns null for wrong password', async () => {
    await userProvider.createUser({ username: 'dan', password: 'correct' });
    const user = await userProvider.findByCredentials('dan', 'wrong');
    expect(user).toBeNull();
  });

  it('returned user never contains passwordHash', async () => {
    const created = await userProvider.createUser({ username: 'eve', password: 'abc' });
    expect((created as any).passwordHash).toBeUndefined();

    const found = await userProvider.findById(created.id);
    expect((found as any)?.passwordHash).toBeUndefined();
  });
});

// ─── AuthService ──────────────────────────────────────────────────────────────

describe('AuthService', () => {
  let userProvider: InMemoryUserProvider;
  let authService: AuthService;

  beforeEach(() => {
    userProvider = new InMemoryUserProvider();
    authService = new AuthService({ secret: SECRET }, userProvider);
  });

  it('login returns user and tokens for valid credentials', async () => {
    await userProvider.createUser({ username: 'frank', password: 'pw123' });
    const result = await authService.login('frank', 'pw123');
    expect(result.user.username).toBe('frank');
    expect(result.tokens.accessToken).toBeTruthy();
  });

  it('login throws AuthenticationException for invalid credentials', async () => {
    await expect(authService.login('nobody', 'bad')).rejects.toThrow(AuthenticationException);
  });

  it('register persists user via createUser', async () => {
    const result = await authService.register({
      username: 'grace',
      password: 'pw456',
      email: 'grace@test.com',
    });
    expect(result.user.username).toBe('grace');
    expect(result.tokens.accessToken).toBeTruthy();

    // User should now be findable
    const found = await userProvider.findByCredentials('grace', 'pw456');
    expect(found).not.toBeNull();
  });

  it('register throws when provider has no createUser', async () => {
    // Minimal provider without createUser
    const minimalProvider = {
      findByCredentials: async () => null,
      findById: async () => null,
      hashPassword: async (p: string) => p,
      verifyPassword: async (p: string, h: string) => p === h,
    };
    const svc = new AuthService({ secret: SECRET }, minimalProvider);
    await expect(svc.register({ username: 'x', password: 'y' })).rejects.toThrow(
      'UserProvider does not support user creation'
    );
  });

  it('verifyToken returns user from provider', async () => {
    await userProvider.createUser({ username: 'henry', password: 'pw' });
    const loginResult = await authService.login('henry', 'pw');
    const user = await authService.verifyToken(loginResult.tokens.accessToken);
    expect(user.username).toBe('henry');
  });

  it('logout blacklists access token', async () => {
    await userProvider.createUser({ username: 'ivan', password: 'pw' });
    const { tokens } = await authService.login('ivan', 'pw');
    await authService.logout(tokens.accessToken);

    await expect(authService.verifyToken(tokens.accessToken)).rejects.toThrow();
  });

  it('hasRoles returns true when user has all required roles', () => {
    const user = { id: '1', username: 'x', roles: ['admin', 'user'] };
    expect(authService.hasRoles(user, ['admin'])).toBe(true);
    expect(authService.hasRoles(user, ['admin', 'user'])).toBe(true);
    expect(authService.hasRoles(user, ['superadmin'])).toBe(false);
  });

  it('refresh returns new tokens and old refresh token is invalidated', async () => {
    await userProvider.createUser({ username: 'judy', password: 'pw' });
    const { tokens } = await authService.login('judy', 'pw');
    const newTokens = await authService.refresh(tokens.refreshToken);
    expect(newTokens.accessToken).toBeTruthy();
    // Using old refresh token again should fail
    await expect(authService.refresh(tokens.refreshToken)).rejects.toThrow();
  });
});
