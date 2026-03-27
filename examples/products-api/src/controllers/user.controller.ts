import { Controller, Get, Post, Body, Param } from 'veloce-ts';
import { z } from 'zod';

const UserSchema = z.object({
  name: z.string(),
  email: z.string().email(),
  age: z.number().min(0).optional(),
});

type User = z.infer<typeof UserSchema>;

@Controller('/users')
export class UserController {
  private users: User[] = [];

  @Get('/')
  async getUsers() {
    return { users: this.users };
  }

  @Get('/:id')
  async getUser(@Param('id') id: string) {
    const user = this.users[parseInt(id)];
    if (!user) {
      throw new Error('User not found');
    }
    return user;
  }

  @Post('/')
  async createUser(@Body(UserSchema) user: User) {
    this.users.push(user);
    return { message: 'User created', user };
  }
}
