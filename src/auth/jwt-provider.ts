// jsonwebtoken is CJS-only. Named ESM imports from it (`import { sign } ...`)
// work under Bun but throw `SyntaxError: Named export 'sign' not found` under
// real Node's ESM loader, so take the default export and destructure instead.
import jsonwebtoken from 'jsonwebtoken';
import { z } from 'zod';
import { TokenBlacklist, MemoryTokenBlacklist } from './token-blacklist.js';

const { sign, verify, decode } = jsonwebtoken;

export interface JWTConfig {
  secret: string;
  expiresIn?: string | number;
  refreshSecret?: string;
  refreshExpiresIn?: string | number;
  algorithm?: 'HS256' | 'HS384' | 'HS512' | 'RS256' | 'RS384' | 'RS512';
  /** PEM private key — required for RS256/RS384/RS512 signing */
  privateKey?: string;
  /** PEM public key — required for RS256/RS384/RS512 verification */
  publicKey?: string;
  issuer?: string;
  audience?: string;
  /** Token revocation store; defaults to in-memory (single instance).
   *  Use RedisTokenBlacklist for multi-instance deployments. */
  blacklist?: TokenBlacklist;
}

export interface TokenPayload {
  sub: string; // subject (user id)
  iat?: number; // issued at
  exp?: number; // expires at
  iss?: string; // issuer
  aud?: string; // audience
  [key: string]: any; // additional claims
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export class JWTProvider {
  private blacklist: TokenBlacklist;

  constructor(private config: JWTConfig) {
    this.blacklist = config.blacklist || new MemoryTokenBlacklist();
    if (this.isAsymmetric()) {
      if (!config.privateKey || !config.publicKey) {
        throw new Error(
          `JWT algorithm ${config.algorithm} requires privateKey and publicKey`
        );
      }
    } else if (!config.secret) {
      throw new Error('JWT secret is required');
    }
  }

  private isAsymmetric(): boolean {
    return /^RS/.test(this.config.algorithm || 'HS256');
  }

  /** Key used to sign tokens (private key for RS*, shared secret for HS*) */
  private signingKey(forRefresh = false): string {
    if (this.isAsymmetric()) return this.config.privateKey!;
    return forRefresh
      ? this.config.refreshSecret || this.config.secret
      : this.config.secret;
  }

  /** Key used to verify tokens (public key for RS*, shared secret for HS*) */
  private verificationKey(forRefresh = false): string {
    if (this.isAsymmetric()) return this.config.publicKey!;
    return forRefresh
      ? this.config.refreshSecret || this.config.secret
      : this.config.secret;
  }

  /**
   * Generate access and refresh token pair
   */
  generateTokens(payload: Omit<TokenPayload, 'iat' | 'exp'>): TokenPair {
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = this.parseExpiration(this.config.expiresIn || '1h');
    
    const accessPayload: TokenPayload = {
      sub: payload.sub,
      ...payload,
      iat: now,
      exp: now + expiresIn,
      iss: this.config.issuer,
      aud: this.config.audience,
    };

    const accessToken = sign(accessPayload, this.signingKey(), {
      algorithm: this.config.algorithm || 'HS256',
    });

    const refreshPayload: TokenPayload = {
      sub: payload.sub,
      type: 'refresh',
      iat: now,
      exp: now + this.parseExpiration(this.config.refreshExpiresIn || '7d'),
      iss: this.config.issuer,
      aud: this.config.audience,
    };

    const refreshToken = sign(refreshPayload, this.signingKey(true), {
      algorithm: this.config.algorithm || 'HS256',
    });

    return {
      accessToken,
      refreshToken,
      expiresIn,
    };
  }

  /**
   * Verify and decode access token
   */
  async verifyAccessToken(token: string): Promise<TokenPayload> {
    if (await this.isBlacklisted(token)) {
      throw new Error('Token has been revoked');
    }

    try {
      const payload = verify(token, this.verificationKey(), {
        algorithms: [this.config.algorithm || 'HS256'],
        issuer: this.config.issuer,
        audience: this.config.audience,
      }) as TokenPayload;

      // Reject refresh tokens presented as access tokens: with a shared
      // refreshSecret they verify under the same key, so the type claim is
      // the only thing separating a 7-day refresh token from an access token
      if (payload.type === 'refresh') {
        throw new Error('Refresh token cannot be used as access token');
      }

      return payload;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Invalid token: ${error.message}`);
      }
      throw new Error('Invalid token');
    }
  }

  /**
   * Verify and decode refresh token
   */
  async verifyRefreshToken(token: string): Promise<TokenPayload> {
    if (await this.isBlacklisted(token)) {
      throw new Error('Refresh token has been revoked');
    }

    try {
      const payload = verify(token, this.verificationKey(true), {
        algorithms: [this.config.algorithm || 'HS256'],
        issuer: this.config.issuer,
        audience: this.config.audience,
      }) as TokenPayload;

      if (payload.type !== 'refresh') {
        throw new Error('Invalid refresh token type');
      }

      return payload;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Invalid refresh token: ${error.message}`);
      }
      throw new Error('Invalid refresh token');
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(refreshToken: string): Promise<TokenPair> {
    const payload = await this.verifyRefreshToken(refreshToken);

    // Blacklist the old refresh token
    await this.blacklistToken(refreshToken);
    
    // Generate new token pair
    return this.generateTokens({
      sub: payload.sub,
      // Copy other claims except system ones
      ...Object.fromEntries(
        Object.entries(payload).filter(([key]) => 
          !['iat', 'exp', 'iss', 'aud', 'type'].includes(key)
        )
      ),
    });
  }

  /**
   * Decode token without verification (for inspection)
   */
  decodeToken(token: string): TokenPayload | null {
    try {
      return decode(token) as TokenPayload;
    } catch {
      return null;
    }
  }

  /**
   * Blacklist a token (for logout).
   * Stores the token's expiry so the store can drop expired entries.
   */
  async blacklistToken(token: string): Promise<void> {
    const payload = this.decodeToken(token);
    const exp = payload?.exp ?? (Math.floor(Date.now() / 1000) + 3600);
    await this.blacklist.add(token, exp);
  }

  /**
   * Check if token is blacklisted.
   */
  async isBlacklisted(token: string): Promise<boolean> {
    return this.blacklist.has(token);
  }

  /**
   * Remove all expired tokens from the blacklist.
   */
  async cleanupBlacklist(): Promise<void> {
    await this.blacklist.cleanup();
  }

  private parseExpiration(exp: string | number): number {
    if (typeof exp === 'number') {
      return exp;
    }

    const units: Record<string, number> = {
      s: 1,
      m: 60,
      h: 3600,
      d: 86400,
      w: 604800,
    };

    const match = exp.match(/^(\d+)([smhdw])$/);
    if (!match) {
      throw new Error(`Invalid expiration format: ${exp}`);
    }

    const [, value, unit] = match;
    return parseInt(value) * units[unit];
  }
}

// Zod schemas for validation
export const TokenPayloadSchema = z.object({
  sub: z.string(),
  iat: z.number().optional(),
  exp: z.number().optional(),
  iss: z.string().optional(),
  aud: z.string().optional(),
}).passthrough();

export const LoginRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const RefreshRequestSchema = z.object({
  refreshToken: z.string().min(1),
});