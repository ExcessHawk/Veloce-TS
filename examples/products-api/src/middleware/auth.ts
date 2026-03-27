import { JWTProvider } from 'veloce-ts';

export const jwtProvider = new JWTProvider({
  secret: process.env.JWT_SECRET || 'products-api-secret-key-minimum-32-chars!!',
  expiresIn: '2h',
  refreshExpiresIn: '7d',
});

/** Hono middleware that validates Bearer JWT and sets ctx.user */
export const requireAuth = async (c: any, next: any): Promise<any> => {
  const header = c.req.header('Authorization');
  const token  = header?.replace('Bearer ', '').trim();

  if (!token) {
    return c.json({ error: 'Authorization header required', code: 'UNAUTHORIZED' }, 401);
  }

  try {
    const payload = jwtProvider.verifyAccessToken(token);
    c.set('user', payload);
    await next();
  } catch {
    return c.json({ error: 'Invalid or expired token', code: 'INVALID_TOKEN' }, 401);
  }
};
