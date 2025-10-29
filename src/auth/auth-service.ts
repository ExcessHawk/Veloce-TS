import { JWTProvider, JWTConfig, TokenPayload, TokenPair } from './jwt-provider.js';
import { AuthenticationException, InvalidTokenException, TokenExpiredException } from './exceptions.js';
import { z } from 'zod';

export interface User {
  id: string;
  username: string;
  email?: string;
  roles?: string[];
  permissions?: string[];
  [key: string]: any;
}

export interface AuthResult {
  user: User;
  tokens: TokenPair;
}

export interface UserProvider {
  findByCredentials(username: string, password: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  hashPassword(password: string): Promise<string>;
  verifyPassword(password: string, hash: string): Promise<boolean>;
}

export class AuthService {
  private jwtProvider: JWTProvider;

  constructor(
    private config: JWTConfig,
    private userProvider: UserProvider
  ) {
    this.jwtProvider = new JWTProvider(config);
  }

  /**
   * Authenticate user with username/password
   */
  async login(username: string, password: string): Promise<AuthResult> {
    const user = await this.userProvider.findByCredentials(username, password);
    
    if (!user) {
      throw new AuthenticationException('Invalid credentials');
    }

    const tokens = this.jwtProvider.generateTokens({
      sub: user.id,
      username: user.username,
      email: user.email,
      roles: user.roles || [],
      permissions: user.permissions || [],
    });

    return { user, tokens };
  }

  /**
   * Refresh access token
   */
  async refresh(refreshToken: string): Promise<TokenPair> {
    try {
      return this.jwtProvider.refreshAccessToken(refreshToken);
    } catch (error) {
      throw new InvalidTokenException(
        error instanceof Error ? error.message : 'Invalid refresh token'
      );
    }
  }

  /**
   * Logout user (blacklist tokens)
   */
  async logout(accessToken: string, refreshToken?: string): Promise<void> {
    this.jwtProvider.blacklistToken(accessToken);
    
    if (refreshToken) {
      this.jwtProvider.blacklistToken(refreshToken);
    }
  }

  /**
   * Verify access token and get user
   */
  async verifyToken(token: string): Promise<User> {
    try {
      const payload = this.jwtProvider.verifyAccessToken(token);
      
      // Get fresh user data
      const user = await this.userProvider.findById(payload.sub);
      
      if (!user) {
        throw new AuthenticationException('User not found');
      }

      return user;
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('expired')) {
          throw new TokenExpiredException();
        }
        throw new InvalidTokenException(error.message);
      }
      throw new InvalidTokenException('Token verification failed');
    }
  }

  /**
   * Get user from token payload (without database lookup)
   */
  getUserFromToken(token: string): TokenPayload {
    return this.jwtProvider.verifyAccessToken(token);
  }

  /**
   * Check if user has required roles
   */
  hasRoles(user: User | TokenPayload, requiredRoles: string[]): boolean {
    const userRoles = user.roles || [];
    return requiredRoles.every(role => userRoles.includes(role));
  }

  /**
   * Check if user has required permissions
   */
  hasPermissions(user: User | TokenPayload, requiredPermissions: string[]): boolean {
    const userPermissions = user.permissions || [];
    return requiredPermissions.every(permission => userPermissions.includes(permission));
  }

  /**
   * Register new user
   */
  async register(userData: {
    username: string;
    password: string;
    email?: string;
    roles?: string[];
  }): Promise<AuthResult> {
    const hashedPassword = await this.userProvider.hashPassword(userData.password);
    
    // This would typically create the user in the database
    // For now, we'll assume the userProvider handles this
    const user: User = {
      id: crypto.randomUUID(),
      username: userData.username,
      email: userData.email,
      roles: userData.roles || ['user'],
    };

    const tokens = this.jwtProvider.generateTokens({
      sub: user.id,
      username: user.username,
      email: user.email,
      roles: user.roles,
    });

    return { user, tokens };
  }

  /**
   * Clean up expired blacklisted tokens
   */
  cleanup(): void {
    this.jwtProvider.cleanupBlacklist();
  }

  /**
   * Get JWT provider instance
   */
  getJWTProvider(): JWTProvider {
    return this.jwtProvider;
  }
}

// Default in-memory user provider for testing
export class InMemoryUserProvider implements UserProvider {
  private users: Map<string, User & { passwordHash: string }> = new Map();

  async findByCredentials(username: string, password: string): Promise<User | null> {
    for (const [id, user] of this.users) {
      if (user.username === username) {
        const isValid = await this.verifyPassword(password, user.passwordHash);
        if (isValid) {
          const { passwordHash, ...userWithoutPassword } = user;
          return userWithoutPassword;
        }
      }
    }
    return null;
  }

  async findById(id: string): Promise<User | null> {
    const user = this.users.get(id);
    if (user) {
      const { passwordHash, ...userWithoutPassword } = user;
      return userWithoutPassword;
    }
    return null;
  }

  async hashPassword(password: string): Promise<string> {
    // In a real implementation, use bcrypt or similar
    return Buffer.from(password).toString('base64');
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    const hashedInput = await this.hashPassword(password);
    return hashedInput === hash;
  }

  async createUser(userData: {
    username: string;
    password: string;
    email?: string;
    roles?: string[];
  }): Promise<User> {
    const id = crypto.randomUUID();
    const passwordHash = await this.hashPassword(userData.password);
    
    const user = {
      id,
      username: userData.username,
      email: userData.email,
      roles: userData.roles || ['user'],
      passwordHash,
    };

    this.users.set(id, user);

    const { passwordHash: _, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }
}