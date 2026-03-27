import { Command } from 'commander';
import { mkdir, writeFile } from 'fs/promises';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Interface for npm registry response
interface NpmRegistryResponse {
  'dist-tags': {
    latest: string;
    [key: string]: string;
  };
  versions: Record<string, any>;
  [key: string]: any;
}

// Get latest version from npm
const getLatestVersion = async (): Promise<string> => {
  try {
    // Try to get latest version from npm registry
    const response = await fetch('https://registry.npmjs.org/veloce-ts');
    if (response.ok) {
      const data = await response.json() as NpmRegistryResponse;
      const latestVersion = data['dist-tags']?.latest;
      if (latestVersion && typeof latestVersion === 'string') {
        return latestVersion;
      }
    }
  } catch (error) {
    console.warn('Could not fetch latest version from npm, using fallback');
  }

  // Fallback: try to get version from local package.json
  try {
    const packagePath = join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8')) as { version?: string };
    return packageJson.version || '0.3.0';
  } catch {
    return '0.3.0';
  }
};

async function generateSwaggerUI(projectPath: string): Promise<void> {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>API Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@latest/swagger-ui.css" />
  <style>
    body { margin: 0; padding: 0; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@latest/swagger-ui-bundle.js" crossorigin></script>
  <script src="https://unpkg.com/swagger-ui-dist@latest/swagger-ui-standalone-preset.js" crossorigin></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: '/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        tryItOutEnabled: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        layout: "StandaloneLayout"
      });
    };
  </script>
</body>
</html>`;

  await writeFile(join(projectPath, 'public', 'docs.html'), html);
}

type Template = 'rest' | 'graphql' | 'websocket' | 'fullstack';

interface ProjectOptions {
  template: Template;
}

export function registerNewCommand(program: Command): void {
  program
    .command('new')
    .description('Create a new VeloceTS project')
    .argument('<name>', 'Project name')
    .option('-t, --template <template>', 'Project template (rest, graphql, websocket, fullstack)', 'rest')
    .action(async (name: string, options: ProjectOptions) => {
      await createProject(name, options);
    });
}

async function createProject(name: string, options: ProjectOptions): Promise<void> {
  const projectPath = join(process.cwd(), name);

  // Validate project name
  if (!name || name.trim() === '') {
    console.error('❌ Error: Project name cannot be empty');
    process.exit(1);
  }

  // Check if directory already exists
  if (existsSync(projectPath)) {
    console.error(`❌ Error: Directory "${name}" already exists`);
    process.exit(1);
  }

  console.log(`🚀 Creating new VeloceTS project: ${name}`);
  console.log(`📋 Template: ${options.template}`);

  try {
    // Create project directory
    console.log('📁 Creating project directories...');
    await mkdir(projectPath, { recursive: true });

    // Create subdirectories
    await mkdir(join(projectPath, 'src'), { recursive: true });
    await mkdir(join(projectPath, 'src', 'controllers'), { recursive: true });

    // Generate files based on template
    console.log('📄 Generating configuration files...');
    await generatePackageJson(projectPath, name);
    await generateTsConfig(projectPath);
    await generateGitignore(projectPath);
    await generateReadme(projectPath, name, options.template);

    console.log('🔧 Generating template files...');
    switch (options.template) {
      case 'rest':
        await generateRestTemplate(projectPath);
        break;
      case 'graphql':
        await generateGraphQLTemplate(projectPath);
        break;
      case 'websocket':
        await generateWebSocketTemplate(projectPath);
        break;
      case 'fullstack':
        await generateFullstackTemplate(projectPath);
        break;
      default:
        throw new Error(`Unknown template: ${options.template}`);
    }

    // Generate public directory with Swagger UI HTML
    console.log('📚 Setting up documentation...');
    await mkdir(join(projectPath, 'public'), { recursive: true });
    await generateSwaggerUI(projectPath);

    console.log('\n✅ Project created successfully!');
    console.log('\n📋 Next steps:');
    console.log(`   cd ${name}`);
    console.log('   bun install');
    console.log('   bun run dev');
    console.log('\n🌐 Your API will be available at:');
    console.log('   http://localhost:3000');
    console.log('   http://localhost:3000/docs (API Documentation)');
  } catch (error) {
    console.error('❌ Error creating project:', error);

    // Clean up partial project if creation failed
    try {
      if (existsSync(projectPath)) {
        console.log('🧹 Cleaning up partial project...');
        // Note: In a real implementation, you'd want to recursively delete
        // For now, just warn the user
        console.warn(`⚠️  Please manually remove the directory: ${projectPath}`);
      }
    } catch (cleanupError) {
      console.warn('⚠️  Could not clean up partial project:', cleanupError);
    }

    process.exit(1);
  }
}

async function generatePackageJson(projectPath: string, name: string): Promise<void> {
  console.log('📦 Fetching latest VeloceTS version from npm...');
  const latestVersion = await getLatestVersion();
  console.log(`✅ Using VeloceTS version: ${latestVersion}`);

  const packageJson = {
    name,
    version: '0.1.0',
    description: 'A Veloce-TS application',
    type: 'module',
    main: './dist/index.js',
    scripts: {
      dev: 'bun --watch src/index.ts',
      build: 'bun build src/index.ts --outdir dist --target bun',
      start: 'bun run dist/index.js',
      'generate:openapi': 'bun run node_modules/veloce-ts/bin/veloce.ts generate openapi',
      'generate:client': 'bun run node_modules/veloce-ts/bin/veloce.ts generate client',
    },
    dependencies: {
      'veloce-ts': `^${latestVersion}`,
      hono: '^4.0.0', // Use specific version instead of 'latest'
      'reflect-metadata': '^0.2.0',
      zod: '^3.22.0',
    },
    devDependencies: {
      '@types/bun': 'latest',
      typescript: '^5.3.0',
    },
    engines: {
      node: '>=18.0.0',
      bun: '>=1.0.0',
    },
  };

  await writeFile(
    join(projectPath, 'package.json'),
    JSON.stringify(packageJson, null, 2)
  );
}

async function generateTsConfig(projectPath: string): Promise<void> {
  const tsConfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      lib: ['ES2022'],
      moduleResolution: 'bundler',
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      resolveJsonModule: true,
      outDir: './dist',
      rootDir: './src',
    },
    include: ['src/**/*'],
    exclude: ['node_modules', 'dist'],
  };

  await writeFile(
    join(projectPath, 'tsconfig.json'),
    JSON.stringify(tsConfig, null, 2)
  );
}

async function generateGitignore(projectPath: string): Promise<void> {
  const gitignore = `node_modules/
dist/
*.log
.env
.DS_Store
`;

  await writeFile(join(projectPath, '.gitignore'), gitignore);
}

async function generateReadme(projectPath: string, name: string, template: Template): Promise<void> {
  const readme = `# ${name}

A modern TypeScript API built with [Veloce-TS](https://github.com/AlfredoMejia3001/veloce-ts) using the **${template}** template.

## Getting Started

### Install Dependencies

\`\`\`bash
bun install
\`\`\`

### Development

Run the development server with hot reload:

\`\`\`bash
bun run dev
\`\`\`

Your API will be available at http://localhost:3000

### Production

Build and start the production server:

\`\`\`bash
bun run build
bun run start
\`\`\`

## Documentation

- **API Documentation**: Visit http://localhost:3000/docs.html for interactive Swagger UI
- **Veloce-TS Docs**: Check out the [official documentation](https://docs.veloce-ts.com)

## Project Structure

\`\`\`
${name}/
├── src/
│   └── index.ts       # Application entry point
├── package.json
├── tsconfig.json
└── README.md
\`\`\`

## Learn More

- [Veloce-TS GitHub](https://github.com/AlfredoMejia3001/veloce-ts)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
- [Bun Documentation](https://bun.sh/docs)

---

Built with Veloce-TS
`;

  await writeFile(join(projectPath, 'README.md'), readme);
}

async function generateRestTemplate(projectPath: string): Promise<void> {
  // Create main entry point
  const mainFile = `import 'reflect-metadata';
import { Veloce, OpenAPIPlugin } from 'veloce-ts';
import { UserController } from './controllers/user.controller';

const app = new Veloce({
  title: 'My REST API',
  version: '1.0.0',
  description: 'A REST API built with VeloceTS',
  docs: true,
  cors: {
    origin: '*',
    credentials: true,
  },
});

// Enable OpenAPI documentation — serves /openapi.json and /docs automatically
app.usePlugin(new OpenAPIPlugin({
  path: '/openapi.json',
  docsPath: '/docs',
}));

// Register controllers
app.include(UserController);

// Start server
async function startServer() {
  try {
    console.log('🔄 Compiling application...');
    await app.compile();
    console.log('✅ Application compiled successfully');
    
    app.listen(3000, () => {
      console.log('🚀 Server running on http://localhost:3000');
      console.log('📚 API Docs available at http://localhost:3000/docs');
      console.log('📄 OpenAPI Spec at http://localhost:3000/openapi.json');
    });
  } catch (error) {
    console.error('❌ Error starting server:', error);
    process.exit(1);
  }
}

startServer();
`;

  await writeFile(join(projectPath, 'src', 'index.ts'), mainFile);

  // Create example controller
  const controllerFile = `import { Controller, Get, Post, Body, Param } from 'veloce-ts';
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
`;

  await writeFile(join(projectPath, 'src', 'controllers', 'user.controller.ts'), controllerFile);
}

async function generateGraphQLTemplate(projectPath: string): Promise<void> {
  await mkdir(join(projectPath, 'src', 'resolvers'), { recursive: true });

  const mainFile = `import 'reflect-metadata';
import { Veloce } from 'veloce-ts';
import { GraphQLPlugin } from 'veloce-ts/plugins';
import { UserResolver } from './resolvers/user.resolver';

const app = new Veloce({
  title: 'My GraphQL API',
  version: '1.0.0',
});

// Enable GraphQL
app.usePlugin(new GraphQLPlugin({
  resolvers: [UserResolver],
}));

// Compile routes
await app.compile();

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
  console.log('GraphQL Playground at http://localhost:3000/graphql');
});
`;

  await writeFile(join(projectPath, 'src', 'index.ts'), mainFile);

  const resolverFile = `import { Resolver, Query, Mutation, Arg } from 'veloce-ts/graphql';
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
`;

  await writeFile(join(projectPath, 'src', 'resolvers', 'user.resolver.ts'), resolverFile);
}

async function generateWebSocketTemplate(projectPath: string): Promise<void> {
  await mkdir(join(projectPath, 'src', 'websockets'), { recursive: true });

  const mainFile = `import 'reflect-metadata';
import { Veloce } from 'veloce-ts';
import { WebSocketPlugin } from 'veloce-ts/plugins';
import { ChatWebSocket } from './websockets/chat.websocket';

const app = new Veloce({
  title: 'My WebSocket API',
  version: '1.0.0',
});

// Enable WebSocket
app.usePlugin(new WebSocketPlugin({
  handlers: [ChatWebSocket],
}));

// Compile routes
await app.compile();

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
  console.log('WebSocket endpoint at ws://localhost:3000/ws/chat');
});
`;

  await writeFile(join(projectPath, 'src', 'index.ts'), mainFile);

  const websocketFile = `import { WebSocket, OnConnect, OnMessage, OnDisconnect } from 'veloce-ts/websocket';
import { z } from 'zod';
import type { WebSocketConnection } from 'veloce-ts/websocket';

const MessageSchema = z.object({
  type: z.enum(['message', 'join', 'leave']),
  content: z.string(),
  username: z.string(),
});

@WebSocket('/ws/chat')
export class ChatWebSocket {
  @OnConnect()
  handleConnect(connection: WebSocketConnection) {
    console.log('Client connected:', connection.id);
    connection.send({ type: 'system', content: 'Welcome to the chat!' });
  }

  @OnMessage(MessageSchema)
  async handleMessage(connection: WebSocketConnection, message: z.infer<typeof MessageSchema>) {
    console.log('Received message:', message);
    
    // Broadcast to all clients
    connection.broadcast({
      type: 'message',
      username: message.username,
      content: message.content,
      timestamp: new Date().toISOString(),
    });
  }

  @OnDisconnect()
  handleDisconnect(connection: WebSocketConnection) {
    console.log('Client disconnected:', connection.id);
  }
}
`;

  await writeFile(join(projectPath, 'src', 'websockets', 'chat.websocket.ts'), websocketFile);
}

async function generateFullstackTemplate(projectPath: string): Promise<void> {
  await mkdir(join(projectPath, 'src', 'controllers'), { recursive: true });
  await mkdir(join(projectPath, 'src', 'resolvers'), { recursive: true });
  await mkdir(join(projectPath, 'src', 'websockets'), { recursive: true });

  // Generate main file
  const mainFile = `import 'reflect-metadata';
import { Veloce, OpenAPIPlugin } from 'veloce-ts';
import { GraphQLPlugin, WebSocketPlugin } from 'veloce-ts/plugins';
import { UserController } from './controllers/user.controller';
import { UserResolver } from './resolvers/user.resolver';
import { ChatWebSocket } from './websockets/chat.websocket';

const app = new Veloce({
  title: 'My Fullstack API',
  version: '1.0.0',
  description: 'A fullstack API with REST, GraphQL, and WebSocket support',
  docs: true,
  cors: {
    origin: '*',
    credentials: true,
  },
});

// OpenAPI docs — serves /openapi.json and /docs
app.usePlugin(new OpenAPIPlugin({
  path: '/openapi.json',
  docsPath: '/docs',
}));

// GraphQL — serves /graphql with a built-in playground
app.usePlugin(new GraphQLPlugin({
  resolvers: [UserResolver],
  path: '/graphql',
  playground: true,
}));

// WebSocket — registers the chat handler
app.usePlugin(new WebSocketPlugin({
  handlers: [ChatWebSocket],
}));

// REST API
app.include(UserController);

// Start server
async function startServer() {
  try {
    console.log('🔄 Compiling application...');
    await app.compile();
    console.log('✅ Application compiled successfully');

    app.listen(3000, () => {
      console.log('🚀 Server running on http://localhost:3000');
      console.log('📚 REST API docs  → http://localhost:3000/docs');
      console.log('📄 OpenAPI spec   → http://localhost:3000/openapi.json');
      console.log('🔮 GraphQL        → http://localhost:3000/graphql');
      console.log('🔌 WebSocket      → ws://localhost:3000/ws/chat');
    });
  } catch (error) {
    console.error('❌ Error starting server:', error);
    process.exit(1);
  }
}

startServer();
`;

  await writeFile(join(projectPath, 'src', 'index.ts'), mainFile);

  // Generate REST controller
  const controllerFile = `import { Controller, Get, Post, Body, Param } from 'veloce-ts';
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
`;

  await writeFile(join(projectPath, 'src', 'controllers', 'user.controller.ts'), controllerFile);

  // Generate GraphQL resolver
  const resolverFile = `import { Resolver, Query, Mutation, Arg } from 'veloce-ts/graphql';
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
`;

  await writeFile(join(projectPath, 'src', 'resolvers', 'user.resolver.ts'), resolverFile);

  // Generate WebSocket handler
  const websocketFile = `import { WebSocket, OnConnect, OnMessage, OnDisconnect } from 'veloce-ts/websocket';
import { z } from 'zod';
import type { WebSocketConnection } from 'veloce-ts/websocket';

const MessageSchema = z.object({
  type: z.enum(['message', 'join', 'leave']),
  content: z.string(),
  username: z.string(),
});

@WebSocket('/ws/chat')
export class ChatWebSocket {
  @OnConnect()
  handleConnect(connection: WebSocketConnection) {
    console.log('Client connected:', connection.id);
    connection.send({ type: 'system', content: 'Welcome to the chat!' });
  }

  @OnMessage(MessageSchema)
  async handleMessage(connection: WebSocketConnection, message: z.infer<typeof MessageSchema>) {
    console.log('Received message:', message);
    
    // Broadcast to all clients
    connection.broadcast({
      type: 'message',
      username: message.username,
      content: message.content,
      timestamp: new Date().toISOString(),
    });
  }

  @OnDisconnect()
  handleDisconnect(connection: WebSocketConnection) {
    console.log('Client disconnected:', connection.id);
  }
}
`;

  await writeFile(join(projectPath, 'src', 'websockets', 'chat.websocket.ts'), websocketFile);
}
