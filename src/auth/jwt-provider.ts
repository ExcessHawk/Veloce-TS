import { sign, verify, decode } from 'jsonwebtoken';
import { z } from 'zod';

export interface JWTConfig {
  secret: string;
  expiresIn?: string | number;
  refreshSecret?: string;
  refreshExpiresIn?: string | number;
  algorithm?: 'HS256' | 'HS384' | 'HS512' | 'RS256' | 'RS384' | 'RS512';
  issuer?: string;
  audience?: string;
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
  private blacklistedTokens: Set<string> = new Set();
  
  constructor(private config: JWTConfig) {
    if (!config.secret) {
      throw new Error('JWT secret is required');
    }
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

    const accessToken = sign(accessPayload, this.config.secret, {
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

    const refreshToken = sign(
      refreshPayload,
      this.config.refreshSecret || this.config.secret,
      {
        algorithm: this.config.algorithm || 'HS256',
      }
    );

    return {
      accessToken,
      refreshToken,
      expiresIn,
    };
  }

  /**
   * Verify and decode access token
   */
  verifyAccessToken(token: string): TokenPayload {
    if (this.isBlacklisted(token)) {
      throw new Error('Token has been revoked');
    }

    try {
      const payload = verify(token, this.config.secret, {
        algorithms: [this.config.algorithm || 'HS256'],
        issuer: this.config.issuer,
        audience: this.config.audience,
      }) as TokenPayload;

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
  verifyRefreshToken(token: string): TokenPayload {
    if (this.isBlacklisted(token)) {
      throw new Error('Refresh token has been revoked');
    }

    try {
      const payload = verify(
        token,
        this.config.refreshSecret || this.config.secret,
        {
          algorithms: [this.config.algorithm || 'HS256'],
          issuer: this.config.issuer,
          audience: this.config.audience,
        }
      ) as TokenPayload;

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
  refreshAccessToken(refreshToken: string): TokenPair {
    const payload = this.verifyRefreshToken(refreshToken);
    
    // Blacklist the old refresh token
    this.blacklistToken(refreshToken);
    
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
   * Blacklist a token (for logout)
   */
  blacklistToken(token: string): void {
    this.blacklistedTokens.add(token);
  }

  /**
   * Check if token is blacklisted
   */
  isBlacklisted(token: string): boolean {
    return this.blacklistedTokens.has(token);
  }

  /**
   * Clear expired tokens from blacklist
   */
  cleanupBlacklist(): void {
    const now = Math.floor(Date.now() / 1000);
    
    for (const token of this.blacklistedTokens) {
      const payload = this.decodeToken(token);
      if (payload && payload.exp && payload.exp < now) {
        this.blacklistedTokens.delete(token);
      }
    }
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