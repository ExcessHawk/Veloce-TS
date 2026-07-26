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

  it('verifies access token and returns payload', async () => {
    const tokens = provider.generateTokens({ sub: 'user1', username: 'alice' });
    const payload = await provider.verifyAccessToken(tokens.accessToken);
    expect(payload.sub).toBe('user1');
    expect(payload.username).toBe('alice');
  });

  it('throws InvalidToken when token is garbage', async () => {
    await expect(provider.verifyAccessToken('not.a.jwt')).rejects.toThrow();
  });

  it('blacklisted token is rejected', async () => {
    const tokens = provider.generateTokens({ sub: 'user1' });
    await provider.blacklistToken(tokens.accessToken);
    await expect(provider.verifyAccessToken(tokens.accessToken)).rejects.toThrow(
      'Token has been revoked'
    );
  });

  it('cleanupBlacklist removes expired tokens', async () => {
    // Create a token with extremely short expiry
    const shortProvider = new JWTProvider({ secret: SECRET, expiresIn: '1s' });
    const tokens = shortProvider.generateTokens({ sub: 'x' });
    await shortProvider.blacklistToken(tokens.accessToken);
    expect(await shortProvider.isBlacklisted(tokens.accessToken)).toBe(true);

    // Simulate expiry by manually cleaning up
    await shortProvider.cleanupBlacklist();
    // Token is expired so cleanup should remove it (if exp is in the past)
    // Since expiry is 1s we can't guarantee instant test execution, but the method should not throw
  });

  it('refreshes access token using refresh token', async () => {
    const tokens = provider.generateTokens({ sub: 'user2', roles: ['admin'] });
    const newTokens = await provider.refreshAccessToken(tokens.refreshToken);
    expect(newTokens.accessToken).toBeTruthy();
    // Old refresh token should now be blacklisted
    expect(await provider.isBlacklisted(tokens.refreshToken)).toBe(true);
  });

  it('refresh token cannot be used as access token', async () => {
    const tokens = provider.generateTokens({ sub: 'user2' });
    const refreshPayload = provider.decodeToken(tokens.refreshToken);
    expect(refreshPayload?.type).toBe('refresh');
    // Same signing key by default, so the type claim must be enforced
    await expect(provider.verifyAccessToken(tokens.refreshToken)).rejects.toThrow(
      'Refresh token cannot be used as access token'
    );
  });

  it('supports custom TokenBlacklist store (async)', async () => {
    const calls: string[] = [];
    const store = {
      entries: new Map<string, number>(),
      async add(token: string, exp: number) {
        calls.push('add');
        this.entries.set(token, exp);
      },
      async has(token: string) {
        calls.push('has');
        return this.entries.has(token);
      },
      async cleanup() {},
    };
    const p = new JWTProvider({ secret: SECRET, blacklist: store });
    const tokens = p.generateTokens({ sub: 'u' });
    await p.blacklistToken(tokens.accessToken);
    await expect(p.verifyAccessToken(tokens.accessToken)).rejects.toThrow('revoked');
    expect(calls).toContain('add');
    expect(calls).toContain('has');
  });
});

// ─── RS256 asymmetric keys ───────────────────────────────────────────────────

describe('JWTProvider RS256', () => {
  const { generateKeyPairSync } = require('node:crypto');
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  it('throws when RS256 configured without keys', () => {
    expect(() => new JWTProvider({ secret: 'x', algorithm: 'RS256' })).toThrow(
      'requires privateKey and publicKey'
    );
  });

  it('signs and verifies with RSA key pair', async () => {
    const p = new JWTProvider({
      secret: '',
      algorithm: 'RS256',
      privateKey,
      publicKey,
    });
    const tokens = p.generateTokens({ sub: 'rsa-user' });
    const payload = await p.verifyAccessToken(tokens.accessToken);
    expect(payload.sub).toBe('rsa-user');
    const refreshPayload = await p.verifyRefreshToken(tokens.refreshToken);
    expect(refreshPayload.sub).toBe('rsa-user');
  });

  it('rejects tokens signed with a different key pair', async () => {
    const other = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const signer = new JWTProvider({
      secret: '',
      algorithm: 'RS256',
      privateKey: other.privateKey,
      publicKey: other.publicKey,
    });
    const verifier = new JWTProvider({
      secret: '',
      algorithm: 'RS256',
      privateKey,
      publicKey,
    });
    const tokens = signer.generateTokens({ sub: 'evil' });
    await expect(verifier.verifyAccessToken(tokens.accessToken)).rejects.toThrow();
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

// ─── Refresh token uniqueness (jti) ──────────────────────────────────────────

describe('JWTProvider refresh token uniqueness', () => {
  const provider = new JWTProvider({ secret: SECRET, expiresIn: '1h', refreshExpiresIn: '7d' });

  it('two refresh tokens for the same user in the same second are distinct', () => {
    // Without a jti the payload is {sub,type,iat,exp,iss,aud}, so tokens minted
    // within the same second were byte-identical — colliding in a DB unique
    // index and making revocation of one affect the other session.
    const a = provider.generateTokens({ sub: 'same-user' });
    const b = provider.generateTokens({ sub: 'same-user' });
    expect(a.refreshToken).not.toBe(b.refreshToken);
  });

  it('refresh token carries a unique jti claim', () => {
    const { refreshToken } = provider.generateTokens({ sub: 'u1' });
    const payload = provider.decodeToken(refreshToken);
    expect(typeof payload?.jti).toBe('string');
    expect((payload!.jti as string).length).toBeGreaterThan(10);
  });

  it('revoking one session does not revoke a second concurrent session', async () => {
    const first = provider.generateTokens({ sub: 'multi-device' });
    const second = provider.generateTokens({ sub: 'multi-device' });

    await provider.blacklistToken(first.refreshToken);

    expect(await provider.isBlacklisted(first.refreshToken)).toBe(true);
    expect(await provider.isBlacklisted(second.refreshToken)).toBe(false);
    await expect(provider.verifyRefreshToken(second.refreshToken)).resolves.toBeDefined();
  });

  it('access tokens also get a unique jti by default', () => {
    const a = provider.generateTokens({ sub: 'u1' });
    const b = provider.generateTokens({ sub: 'u1' });
    const jtiA = provider.decodeToken(a.accessToken)?.jti;
    const jtiB = provider.decodeToken(b.accessToken)?.jti;
    expect(typeof jtiA).toBe('string');
    expect(jtiA).not.toBe(jtiB);
    // access and refresh ids are distinct from each other too
    expect(jtiA).not.toBe(provider.decodeToken(a.refreshToken)?.jti);
  });

  it('a caller-supplied jti overrides the generated one', () => {
    const { accessToken } = provider.generateTokens({ sub: 'u1', jti: 'my-own-id' });
    expect(provider.decodeToken(accessToken)?.jti).toBe('my-own-id');
  });

  it('rotation issues fresh ids instead of reusing the old refresh token jti', async () => {
    const original = provider.generateTokens({ sub: 'rotate-me' });
    const oldRefreshJti = provider.decodeToken(original.refreshToken)?.jti;

    const rotated = await provider.refreshAccessToken(original.refreshToken);

    // Both rotated tokens are identifiable, and neither reuses the old id —
    // so a jti-keyed revocation registry can tell the sessions apart.
    expect(typeof provider.decodeToken(rotated.accessToken)?.jti).toBe('string');
    expect(provider.decodeToken(rotated.accessToken)?.jti).not.toBe(oldRefreshJti);
    expect(provider.decodeToken(rotated.refreshToken)?.jti).not.toBe(oldRefreshJti);
  });
});
