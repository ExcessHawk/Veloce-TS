import { Command } from 'commander';
import { spawnSync } from 'child_process';
import { mkdir, writeFile } from 'fs/promises';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getScaffoldVersionRange } from '../version.js';
import { bunAvailable } from './runtime.js';

// Interface for npm registry response
interface NpmRegistryResponse {
  'dist-tags': {
    latest: string;
    [key: string]: string;
  };
  versions: Record<string, any>;
  [key: string]: any;
}

/** Give up on the registry rather than hanging a scaffold on a slow network. */
const REGISTRY_TIMEOUT_MS = 5_000;

/**
 * The version range to write into the new project's dependencies.
 *
 * Asks npm for the latest release, and falls back to the version of the CLI
 * doing the scaffolding — which is by definition installed and real. The old
 * fallbacks were the *current directory's* package.json (whatever the user
 * happened to be standing in, not veloce-ts at all) and then a hardcoded
 * `'0.3.0'`, which would have been written straight into a new project.
 */
const getLatestVersion = async (): Promise<string> => {
  try {
    const response = await fetch('https://registry.npmjs.org/veloce-ts', {
      signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
    });
    if (response.ok) {
      const data = await response.json() as NpmRegistryResponse;
      const latestVersion = data['dist-tags']?.latest;
      if (latestVersion && typeof latestVersion === 'string') {
        return `^${latestVersion}`;
      }
    }
  } catch {
    // Offline, slow, or the registry is down — the installed version is fine.
  }

  const fallback = getScaffoldVersionRange();
  console.warn(`⚠️  Could not reach npm; using the installed version (${fallback}).`);
  return fallback;
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
  /** Run the package manager's install after writing the files. */
  install?: boolean;
  /** `git init` plus an initial commit. */
  git?: boolean;
}

export function registerNewCommand(program: Command): void {
  program
    .command('new')
    .description('Create a new VeloceTS project')
    .argument('<name>', 'Project name')
    .option('-t, --template <template>', 'Project template (rest, graphql, websocket, fullstack)', 'rest')
    .option('--install', 'Install dependencies after scaffolding')
    .option('--git', 'Initialise a git repository and make the first commit')
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

    // Only `src` is universal; each template creates the subdirectories it
    // actually fills, so a GraphQL project does not ship an empty controllers/.
    await mkdir(join(projectPath, 'src'), { recursive: true });

    // Generate files based on template
    console.log('📄 Generating configuration files...');
    await generatePackageJson(projectPath, name, options.template);
    await generateTsConfig(projectPath);
    await generateGitignore(projectPath);
    await generateEnvExample(projectPath, options.template);
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

    if (options.git) {
      await initGitRepository(projectPath);
    }

    let installed = false;
    if (options.install) {
      installed = await installDependencies(projectPath);
    }

    console.log('\n✅ Project created successfully!');
    console.log('\n📋 Next steps:');
    console.log(`   cd ${name}`);
    if (!installed) {
      console.log('   npm install    (or: bun install)');
    }
    console.log('   npm run dev    (or: bun run dev)');
    console.log('\n🌐 Your API will be available at:');
    console.log('   http://localhost:3000');
    console.log('   http://localhost:3000/docs (API Documentation)');

  } catch (error) {
    console.error('❌ Error creating project:', error);

    // Clean up partial project if creation failed
    try {
      if (existsSync(projectPath)) {
        console.log('🧹 Cleaning up partial project...');
        console.warn(`⚠️  Please manually remove the directory: ${projectPath}`);
      }
    } catch (cleanupError) {
      console.warn('⚠️  Could not clean up partial project:', cleanupError);
    }

    process.exit(1);
  }
}

async function generatePackageJson(
  projectPath: string,
  name: string,
  template: Template
): Promise<void> {
  console.log('📦 Fetching latest VeloceTS version from npm...');
  const latestVersion = await getLatestVersion();
  console.log(`✅ Using VeloceTS ${latestVersion}`);

  const usesGraphQL = template === 'graphql' || template === 'fullstack';

  const packageJson = {
    name,
    version: '0.1.0',
    description: 'A Veloce-TS application',
    type: 'module',
    main: './dist/index.js',
    scripts: {
      // Routed through the veloce binary so the same script works under Bun and
      // Node — the CLI picks the right runner instead of hardcoding `bun`.
      dev: 'veloce dev',
      build: 'veloce build',
      start: 'node dist/index.js',
      typecheck: 'tsc --noEmit',
      'generate:openapi': 'veloce generate openapi',
      'generate:client': 'veloce generate client',
    },
    dependencies: {
      'veloce-ts': latestVersion,
      // Required for app.listen() under Node; Bun and Deno serve natively.
      '@hono/node-server': '^1.19.0',
      // WebSocket upgrades on Node — the gateway plugin and GraphQL
      // subscriptions both need it. Unused under Bun/Deno, which upgrade
      // natively.
      '@hono/node-ws': '^1.3.0',
      hono: '^4.0.0',
      'reflect-metadata': '^0.2.0',
      zod: '^3.22.0',
      // graphql is an optional peer of veloce-ts: nothing executes without it,
      // so the templates that use it must depend on it explicitly. Its absence
      // is not a type error, only a 501 at the first query.
      ...(usesGraphQL ? { graphql: '^16.9.0' } : {}),
    },
    devDependencies: {
      '@types/node': '^22.0.0',
      // Node has no built-in TypeScript runner that handles decorators, so the
      // dev server falls back to tsx when Bun is not installed.
      tsx: '^4.19.0',
      typescript: '^5.3.0',
    },
    engines: {
      node: '>=20.0.0',
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
      // 'bundler' resolution, but the templates still write the '.js' extension
      // on relative imports. tsc emits those specifiers verbatim, and Node's ESM
      // loader requires the extension — without it `node dist/index.js` dies with
      // ERR_MODULE_NOT_FOUND. Bun resolves '.js' back to the '.ts' source, so the
      // same sources run on both runtimes.
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

/** Per-template project layout, so the README matches what was written. */
const TEMPLATE_LAYOUTS: Record<Template, string[]> = {
  rest: [
    '├── src/',
    '│   ├── index.ts                      # Application entry point',
    '│   ├── controllers/',
    '│   │   └── user.controller.ts        # REST routes, injects UserService',
    '│   └── services/',
    '│       └── user.service.ts           # Resolved through the DI container',
  ],
  graphql: [
    '├── src/',
    '│   ├── index.ts                      # Application entry point',
    '│   ├── resolvers/',
    '│   │   └── user.resolver.ts          # Queries, mutations and a subscription',
    '│   └── services/',
    '│       └── user.service.ts           # Resolved through the DI container',
  ],
  websocket: [
    '├── src/',
    '│   ├── index.ts                      # Application entry point',
    '│   └── websockets/',
    '│       └── chat.websocket.ts         # Gateway: @OnConnect/@OnMessage/@OnDisconnect',
  ],
  fullstack: [
    '├── src/',
    '│   ├── index.ts                      # Application entry point',
    '│   ├── controllers/',
    '│   │   └── user.controller.ts        # REST routes, injects UserService',
    '│   ├── resolvers/',
    '│   │   └── user.resolver.ts          # Queries, mutations and a subscription',
    '│   ├── services/',
    '│   │   └── user.service.ts           # Resolved through the DI container',
    '│   └── websockets/',
    '│       └── chat.websocket.ts         # Gateway: @OnConnect/@OnMessage/@OnDisconnect',
  ],
};

/** Endpoints each template actually serves. */
const TEMPLATE_ENDPOINTS: Record<Template, string[]> = {
  rest: [
    '| REST API | http://localhost:3000/users |',
    '| Swagger UI | http://localhost:3000/docs |',
    '| OpenAPI spec | http://localhost:3000/openapi.json |',
  ],
  graphql: [
    '| GraphQL | http://localhost:3000/graphql |',
    '| Playground | http://localhost:3000/graphql/playground |',
    '| Subscriptions | ws://localhost:3000/graphql |',
  ],
  websocket: ['| WebSocket | ws://localhost:3000/ws/chat |'],
  fullstack: [
    '| REST API | http://localhost:3000/users |',
    '| Swagger UI | http://localhost:3000/docs |',
    '| OpenAPI spec | http://localhost:3000/openapi.json |',
    '| GraphQL | http://localhost:3000/graphql |',
    '| Subscriptions | ws://localhost:3000/graphql |',
    '| WebSocket | ws://localhost:3000/ws/chat |',
  ],
};

async function generateReadme(projectPath: string, name: string, template: Template): Promise<void> {
  const hasSubscriptions = template === 'graphql' || template === 'fullstack';

  const subscriptionSection = hasSubscriptions
    ? `
## Subscriptions

The GraphQL endpoint serves subscriptions over the \`graphql-transport-ws\` subprotocol — the one
Apollo Client, urql and GraphiQL speak — on the same URL as queries and mutations.

Open the playground in two tabs: run \`subscription { userCreated { id name } }\` in one and the
\`createUser\` mutation in the other.

A browser WebSocket cannot send an \`Authorization\` header, so credentials travel in
\`connectionParams\`. Gate the connection by replacing \`subscriptions: true\` with:

\`\`\`typescript
subscriptions: {
  onConnect: ({ connectionParams }) => Boolean(verify(connectionParams?.token)),
}
\`\`\`
`
    : '';

  const readme = `# ${name}

A TypeScript API built with [Veloce-TS](https://github.com/ExcessHawk/veloce-ts) using the **${template}** template.

## Getting started

\`\`\`bash
npm install        # or: bun install
cp .env.example .env
npm run dev        # or: bun run dev
\`\`\`

The scripts route through the \`veloce\` binary rather than hardcoding a runtime, so the same
project runs under **Node 20+** and **Bun**. \`veloce dev\` picks whichever is available; force one
with \`--runtime node\` or \`--runtime bun\`.

## Endpoints

| What | Where |
|------|-------|
${TEMPLATE_ENDPOINTS[template].join('\n')}

## Scripts

| Script | Does |
|--------|------|
| \`dev\` | Development server with hot reload |
| \`build\` | Compile to \`dist/\` |
| \`start\` | Run the compiled output |
| \`typecheck\` | \`tsc --noEmit\` |
| \`generate:openapi\` | Write the OpenAPI spec to a file |
| \`generate:client\` | Generate a typed client from that spec |

## Configuration

Environment variables live in \`.env\`; \`.env.example\` lists every one the code reads. Note that
\`CORS_ORIGINS\` must name real origins — a wildcard cannot be combined with credentials, and
veloce-ts refuses that combination at startup rather than letting browsers reject the responses.

## Project structure

\`\`\`
${name}/
${TEMPLATE_LAYOUTS[template].join('\n')}
├── public/
│   └── docs.html                     # Swagger UI shell
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
\`\`\`

## Adding code

\`\`\`bash
npx veloce generate module order       # controller + service + dto + barrel
npx veloce generate controller order
npx veloce generate service billing
npx veloce generate gateway presence   # WebSocket gateway
npx veloce generate listener audit     # @On event listeners
npx veloce generate dto order
\`\`\`

Dependencies are injected, not constructed: the example controller asks for \`UserService\` with
\`@Inject(UserService)\` and the container builds it. Swap the in-memory array in the service for a
database and nothing else changes.
${subscriptionSection}
## Learn more

- [Veloce-TS documentation](https://docs.veloce-ts.com)
- [Veloce-TS on GitHub](https://github.com/ExcessHawk/veloce-ts)

---

Built with Veloce-TS
`;

  await writeFile(join(projectPath, 'README.md'), readme);
}

async function generateEnvExample(projectPath: string, template: Template): Promise<void> {
  const lines = [
    '# Copy to .env and adjust. Values here are the defaults the code falls back to.',
    '',
    '# Port the server listens on.',
    'PORT=3000',
    '',
    '# Comma-separated origins allowed to send cookies or an Authorization header.',
    '# A wildcard cannot be combined with credentials — browsers reject such',
    '# responses, and veloce-ts refuses the combination at startup.',
    'CORS_ORIGINS=http://localhost:5173',
    '',
    '# Set to "production" to enable the production defaults (secure cookies,',
    '# no stack traces in error responses).',
    'NODE_ENV=development',
  ];

  if (template === 'graphql' || template === 'fullstack') {
    lines.push(
      '',
      '# Subscriptions authenticate through connectionParams rather than a header;',
      '# this is the secret the example onConnect would verify against.',
      '# JWT_SECRET=change-me'
    );
  }

  await writeFile(join(projectPath, '.env.example'), lines.join('\n') + '\n');
}

/**
 * Run a command in the project directory.
 *
 * `shell` is needed for npm on Windows, where it is an `npm.cmd` shim that Node
 * refuses to spawn directly since the fix for CVE-2024-27980. The command is
 * then passed as one constant string rather than a command plus an args array,
 * because the latter is deprecated under `shell: true` (DEP0190) — it
 * concatenates arguments instead of escaping them. `cwd` is passed as an option
 * either way, so a project path containing spaces is safe.
 */
function runInProject(
  command: string,
  args: string[],
  projectPath: string,
  useShell = false
): boolean {
  try {
    const result = useShell
      ? spawnSync([command, ...args].join(' '), {
          cwd: projectPath,
          stdio: 'inherit',
          shell: true,
          windowsHide: true,
        })
      : spawnSync(command, args, {
          cwd: projectPath,
          stdio: 'inherit',
          shell: false,
          windowsHide: true,
        });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Install dependencies with Bun when it is available, npm otherwise.
 *
 * A failure is reported and swallowed: the project is already written, and
 * telling the user to run the install themselves beats deleting their work.
 *
 * @returns whether the install succeeded
 */
async function installDependencies(projectPath: string): Promise<boolean> {
  const useBun = bunAvailable();
  const manager = useBun ? 'bun' : 'npm';
  console.log(`\n📦 Installing dependencies with ${manager}...`);

  // `bun` is a real executable on every platform; `npm` is a .cmd shim on Windows.
  const ok = useBun
    ? runInProject('bun', ['install'], projectPath)
    : runInProject('npm', ['install', '--no-audit', '--no-fund'], projectPath, process.platform === 'win32');

  if (!ok) {
    console.warn(`⚠️  ${manager} install failed. Run it yourself in the project directory.`);
  }
  return ok;
}

/**
 * `git init` plus the first commit.
 *
 * Skipped when the directory is already inside a repository, so scaffolding
 * into a monorepo does not create a nested one.
 */
async function initGitRepository(projectPath: string): Promise<void> {
  console.log('\n🔧 Initialising git repository...');

  const inRepo = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: projectPath,
    stdio: 'ignore',
    shell: false,
    windowsHide: true,
  });

  if (inRepo.status === 0) {
    console.log('   Already inside a git repository — skipping.');
    return;
  }

  const steps: Array<[string, string[]]> = [
    ['git', ['init', '--quiet']],
    ['git', ['add', '.']],
    ['git', ['commit', '--quiet', '-m', 'Initial commit from veloce new']],
  ];

  for (const [command, args] of steps) {
    if (!runInProject(command, args, projectPath)) {
      console.warn('⚠️  git setup did not complete. The project files are fine; set it up by hand.');
      return;
    }
  }
}

// ============================================================================
// Shared template sources
//
// The fullstack template is the other three combined, so the controller,
// resolver, gateway and service they share live here once instead of being
// duplicated per template — which is how the `handlers` option that does not
// exist survived in two copies until 3.1.0.
// ============================================================================

/**
 * The service every template's controller and resolver injects.
 *
 * Scaffolding that news up its dependencies teaches the wrong thing: the
 * framework has a DI container, and `@Inject` is how a real application reaches
 * a database, a mailer or a cache. Swapping the array below for a repository
 * leaves every caller untouched.
 */
const USER_SERVICE_SOURCE = `import { z } from 'zod';

export const UserSchema = z.object({
  name: z.string(),
  email: z.string().email(),
  age: z.number().min(0).optional(),
});

export type UserInput = z.infer<typeof UserSchema>;
export type User = UserInput & { id: string };

/**
 * Resolved through the DI container: whoever asks for it with
 * \`@Inject(UserService)\` gets this one instance. Replace the in-memory array
 * with your database and the callers do not change.
 */
export class UserService {
  private users: User[] = [];

  list(): User[] {
    return this.users;
  }

  find(id: string): User | undefined {
    return this.users.find(user => user.id === id);
  }

  create(input: UserInput): User {
    const user: User = { id: crypto.randomUUID(), ...input };
    this.users.push(user);
    return user;
  }
}
`;

const USER_CONTROLLER_SOURCE = `import { Controller, Get, Post, Body, Param, Inject, NotFoundException } from 'veloce-ts';
import { UserSchema, UserService, type UserInput } from '../services/user.service.js';

@Controller('/users')
export class UserController {
  // The container builds UserService and hands it over; nothing to register.
  constructor(@Inject(UserService) private readonly users: UserService) {}

  @Get('/')
  async list() {
    return { users: this.users.list() };
  }

  @Get('/:id')
  async get(@Param('id') id: string) {
    const user = this.users.find(id);
    // Throwing a framework exception gives a 404 with the standard error shape;
    // a bare Error would surface as a 500.
    if (!user) throw new NotFoundException(\`User "\${id}" not found\`);
    return user;
  }

  @Post('/')
  async create(@Body(UserSchema) input: UserInput) {
    return this.users.create(input);
  }
}
`;

const USER_RESOLVER_SOURCE = `import {
  Resolver,
  GQLQuery,
  GQLMutation,
  GQLSubscription,
  Arg,
  Returns,
  Inject,
  PubSub,
} from 'veloce-ts';
import { z } from 'zod';
import { UserService } from '../services/user.service.js';

const UserType = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
});

/**
 * The source behind the subscription. Pass \`{ eventBus: globalEvents }\` to
 * share topics with \`@On\` listeners elsewhere in the app.
 */
export const pubsub = new PubSub();

@Resolver('user')
export class UserResolver {
  constructor(@Inject(UserService) private readonly users: UserService) {}

  @GQLQuery('users')
  @Returns(UserType, { name: 'User', list: true })
  async list() {
    return this.users.list();
  }

  @GQLQuery('user')
  @Returns(UserType, { name: 'User', nullable: true })
  async get(@Arg('id', z.string()) id: string) {
    return this.users.find(id) ?? null;
  }

  @GQLMutation('createUser')
  @Returns(UserType, { name: 'User' })
  async create(
    @Arg('name', z.string()) name: string,
    @Arg('email', z.string().email()) email: string
  ) {
    const user = this.users.create({ name, email });
    // Every open subscription receives this.
    await pubsub.publish('USER_CREATED', user);
    return user;
  }

  /**
   * A subscription resolver returns an async iterable. Try it from the
   * playground, then run the createUser mutation in another tab.
   */
  @GQLSubscription('userCreated')
  @Returns(UserType, { name: 'User' })
  userCreated() {
    return pubsub.subscribe('USER_CREATED');
  }
}
`;

const CHAT_GATEWAY_SOURCE = `import { WebSocket, OnConnect, OnMessage, OnDisconnect } from 'veloce-ts/websocket';
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

/** Write the shared service every template's example code injects. */
async function writeUserService(projectPath: string): Promise<void> {
  await mkdir(join(projectPath, 'src', 'services'), { recursive: true });
  await writeFile(join(projectPath, 'src', 'services', 'user.service.ts'), USER_SERVICE_SOURCE);
}

async function generateRestTemplate(projectPath: string): Promise<void> {
  await mkdir(join(projectPath, 'src', 'controllers'), { recursive: true });

  const mainFile = `import 'reflect-metadata';
import { Veloce, OpenAPIPlugin } from 'veloce-ts';
import { UserController } from './controllers/user.controller.js';

const app = new Veloce({
  title: 'My REST API',
  version: '1.0.0',
  description: 'A REST API built with VeloceTS',
  docs: true,
  // A wildcard origin cannot be combined with credentials — browsers reject such
  // responses, and veloce-ts refuses the combination at startup. List the origins
  // that are allowed to send cookies or an Authorization header.
  cors: {
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(','),
    credentials: true,
  },
});

// The port comes from the environment so "veloce dev --port" and a PORT in
// .env both work; 3000 is only the fallback.
const port = Number(process.env.PORT ?? 3000);

// Enable OpenAPI documentation — serves /openapi.json and /docs automatically
app.usePlugin(new OpenAPIPlugin({
  path: '/openapi.json',
  docsPath: '/docs',
}));

// Register controllers
app.include(UserController);

async function startServer() {
  try {
    await app.compile();

    // Awaited on purpose: listen() is async on Node, and without the await a
    // failure to bind becomes an unhandled rejection instead of the error below.
    await app.listen(port, () => {
      console.log(\`🚀 Server running on http://localhost:\${port}\`);
      console.log(\`📚 API Docs available at http://localhost:\${port}/docs\`);
      console.log(\`📄 OpenAPI Spec at http://localhost:\${port}/openapi.json\`);
    });
  } catch (error) {
    console.error('❌ Error starting server:', error);
    process.exit(1);
  }
}

startServer();
`;

  await writeFile(join(projectPath, 'src', 'index.ts'), mainFile);
  await writeUserService(projectPath);
  await writeFile(join(projectPath, 'src', 'controllers', 'user.controller.ts'), USER_CONTROLLER_SOURCE);
}

async function generateGraphQLTemplate(projectPath: string): Promise<void> {
  await mkdir(join(projectPath, 'src', 'resolvers'), { recursive: true });

  const mainFile = `import 'reflect-metadata';
import { Veloce, GraphQLPlugin } from 'veloce-ts';
import { UserResolver } from './resolvers/user.resolver.js';

const app = new Veloce({ title: 'My GraphQL API', version: '1.0.0' });

// The port comes from the environment so "veloce dev --port" and a PORT in
// .env both work; 3000 is only the fallback.
const port = Number(process.env.PORT ?? 3000);

app.usePlugin(new GraphQLPlugin({
  resolvers: [UserResolver],
  playground: true,
  // Serves subscriptions over the graphql-transport-ws subprotocol on the same
  // path. Pass an object instead of \`true\` to gate connections with onConnect —
  // a browser WebSocket cannot send an Authorization header, so a token travels
  // in connectionParams.
  subscriptions: true,
}));

async function startServer() {
  try {
    await app.compile();

    // Awaited on purpose: listen() is async on Node, and the subscription
    // endpoint attaches to the running server once it is up.
    await app.listen(port, () => {
      console.log(\`🚀 Server running on http://localhost:\${port}\`);
      console.log(\`🔮 GraphQL playground at http://localhost:\${port}/graphql/playground\`);
      console.log(\`📡 Subscriptions at ws://localhost:\${port}/graphql\`);
    });
  } catch (error) {
    console.error('❌ Error starting server:', error);
    process.exit(1);
  }
}

startServer();
`;

  await writeFile(join(projectPath, 'src', 'index.ts'), mainFile);
  await writeUserService(projectPath);
  await writeFile(join(projectPath, 'src', 'resolvers', 'user.resolver.ts'), USER_RESOLVER_SOURCE);
}

async function generateWebSocketTemplate(projectPath: string): Promise<void> {
  await mkdir(join(projectPath, 'src', 'websockets'), { recursive: true });

  const mainFile = `import 'reflect-metadata';
import { Veloce } from 'veloce-ts';
import { WebSocketPlugin } from 'veloce-ts/plugins';
import { ChatWebSocket } from './websockets/chat.websocket.js';

const app = new Veloce({
  title: 'My WebSocket API',
  version: '1.0.0',
});

// The port comes from the environment so "veloce dev --port" and a PORT in
// .env both work; 3000 is only the fallback.
const port = Number(process.env.PORT ?? 3000);

// Register the gateway, then enable the plugin. Gateways go through
// app.include() like controllers do — WebSocketPlugin takes connection options
// (heartbeat, idle timeout, max message size), not a list of handlers.
app.include(ChatWebSocket);
app.usePlugin(new WebSocketPlugin());

async function startServer() {
  try {
    await app.compile();

    // Awaited on purpose: on Node the WebSocket handler attaches to the real
    // http.Server, which only exists once listen() has resolved.
    await app.listen(port, () => {
      console.log(\`🚀 Server running on http://localhost:\${port}\`);
      console.log(\`🔌 WebSocket endpoint at ws://localhost:\${port}/ws/chat\`);
    });
  } catch (error) {
    console.error('❌ Error starting server:', error);
    process.exit(1);
  }
}

startServer();
`;

  await writeFile(join(projectPath, 'src', 'index.ts'), mainFile);
  await writeFile(join(projectPath, 'src', 'websockets', 'chat.websocket.ts'), CHAT_GATEWAY_SOURCE);
}

async function generateFullstackTemplate(projectPath: string): Promise<void> {
  await mkdir(join(projectPath, 'src', 'controllers'), { recursive: true });
  await mkdir(join(projectPath, 'src', 'resolvers'), { recursive: true });
  await mkdir(join(projectPath, 'src', 'websockets'), { recursive: true });

  const mainFile = `import 'reflect-metadata';
import { Veloce, OpenAPIPlugin } from 'veloce-ts';
import { GraphQLPlugin, WebSocketPlugin } from 'veloce-ts/plugins';
import { UserController } from './controllers/user.controller.js';
import { UserResolver } from './resolvers/user.resolver.js';
import { ChatWebSocket } from './websockets/chat.websocket.js';

const app = new Veloce({
  title: 'My Fullstack API',
  version: '1.0.0',
  description: 'A fullstack API with REST, GraphQL, and WebSocket support',
  docs: true,
  // A wildcard origin cannot be combined with credentials — browsers reject such
  // responses, and veloce-ts refuses the combination at startup. List the origins
  // that are allowed to send cookies or an Authorization header.
  cors: {
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(','),
    credentials: true,
  },
});

// The port comes from the environment so "veloce dev --port" and a PORT in
// .env both work; 3000 is only the fallback.
const port = Number(process.env.PORT ?? 3000);

// OpenAPI docs — serves /openapi.json and /docs
app.usePlugin(new OpenAPIPlugin({
  path: '/openapi.json',
  docsPath: '/docs',
}));

// GraphQL — queries, mutations and subscriptions on /graphql
app.usePlugin(new GraphQLPlugin({
  resolvers: [UserResolver],
  path: '/graphql',
  playground: true,
  subscriptions: true,
}));

// WebSocket — the gateway is registered with include(), like a controller;
// the plugin itself takes connection options, not a list of handlers.
app.include(ChatWebSocket);
app.usePlugin(new WebSocketPlugin());

// REST API
app.include(UserController);

async function startServer() {
  try {
    await app.compile();

    // Awaited on purpose: on Node both WebSocket surfaces attach to the real
    // http.Server, which only exists once listen() has resolved.
    await app.listen(port, () => {
      console.log(\`🚀 Server running on http://localhost:\${port}\`);
      console.log(\`📚 REST API docs  → http://localhost:\${port}/docs\`);
      console.log(\`📄 OpenAPI spec   → http://localhost:\${port}/openapi.json\`);
      console.log(\`🔮 GraphQL        → http://localhost:\${port}/graphql\`);
      console.log(\`📡 Subscriptions  → ws://localhost:\${port}/graphql\`);
      console.log(\`🔌 WebSocket      → ws://localhost:\${port}/ws/chat\`);
    });
  } catch (error) {
    console.error('❌ Error starting server:', error);
    process.exit(1);
  }
}

startServer();
`;

  await writeFile(join(projectPath, 'src', 'index.ts'), mainFile);
  await writeUserService(projectPath);
  await writeFile(join(projectPath, 'src', 'controllers', 'user.controller.ts'), USER_CONTROLLER_SOURCE);
  await writeFile(join(projectPath, 'src', 'resolvers', 'user.resolver.ts'), USER_RESOLVER_SOURCE);
  await writeFile(join(projectPath, 'src', 'websockets', 'chat.websocket.ts'), CHAT_GATEWAY_SOURCE);
}
