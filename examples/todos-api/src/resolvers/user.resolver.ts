import { Resolver, Query, Mutation, Arg } from 'veloce-ts/graphql';
import { z } from 'zod';

const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
});

type User = z.infer<typeof UserSchema>;

@Resolver()
export class UserResolver {
  private users: User[] = [];

  @Query()
  async users(): Promise<User[]> {
    return this.users;
  }

  @Query()
  async user(@Arg('id', z.string()) id: string): Promise<User | null> {
    return this.users.find(u => u.id === id) || null;
  }

  @Mutation()
  async createUser(
    @Arg('name', z.string()) name: string,
    @Arg('email', z.string().email()) email: string
  ): Promise<User> {
    const user = { id: Date.now().toString(), name, email };
    this.users.push(user);
    return user;
  }
}
