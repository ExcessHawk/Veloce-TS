import { Controller, Post, Body } from 'veloce-ts';
import { BadRequestException, UnauthorizedException } from 'veloce-ts';
import { z } from 'zod';
import { db } from '../db';
import { jwtProvider } from '../middleware/auth';

const RegisterSchema = z.object({
  username: z.string().min(3).max(30),
  email:    z.string().email(),
  password: z.string().min(6),
});

const LoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

@Controller('/auth')
export class AuthController {
  @Post('/register')
  async register(@Body(RegisterSchema) body: z.infer<typeof RegisterSchema>) {
    const exists = db.query(
      'SELECT id FROM users WHERE username = ? OR email = ?'
    ).get(body.username, body.email);

    if (exists) throw new BadRequestException('Username or email already in use');

    const id   = crypto.randomUUID();
    const hash = await Bun.password.hash(body.password);

    db.run(
      'INSERT INTO users (id, username, email, password_hash) VALUES (?, ?, ?, ?)',
      [id, body.username, body.email, hash],
    );

    const tokens = jwtProvider.generateTokens({ sub: id, username: body.username });
    return { success: true, user: { id, username: body.username, email: body.email }, tokens };
  }

  @Post('/login')
  async login(@Body(LoginSchema) body: z.infer<typeof LoginSchema>) {
    const user = db.query('SELECT * FROM users WHERE username = ?').get(body.username) as any;
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const valid = await Bun.password.verify(body.password, user.password_hash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    const tokens = jwtProvider.generateTokens({ sub: user.id, username: user.username });
    return { success: true, user: { id: user.id, username: user.username, email: user.email }, tokens };
  }
}
