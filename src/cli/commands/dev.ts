import { Command } from 'commander';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { detectRunner, describeRunner, resolveLocalTool, TOOL_ENTRIES, type Runner } from './runtime.js';

interface DevOptions {
  port?: number;
  watch?: string;
  runtime?: 'auto' | 'bun' | 'node';
}

export function registerDevCommand(program: Command): void {
  program
    .command('dev')
    .description('Start development server with hot reload')
    .option('-p, --port <port>', 'Port to run the server on', '3000')
    .option('-w, --watch <path>', 'Additional paths to watch', 'src')
    .option('-r, --runtime <runtime>', 'Runtime to use (auto, bun, node)', 'auto')
    .action(async (options: DevOptions) => {
      await startDevServer(options);
    });
}

async function startDevServer(options: DevOptions): Promise<void> {
  const entryPoint = join(process.cwd(), 'src', 'index.ts');

  // Check if entry point exists
  if (!existsSync(entryPoint)) {
    console.error('Error: src/index.ts not found');
    console.error('Make sure you are in a VeloceTS project directory');
    process.exit(1);
  }

  let runner: Runner;
  try {
    runner = detectRunner(options.runtime ?? 'auto', 'dev');
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }

  // Bun watches natively. Under Node we run tsx, which transpiles the decorators
  // Node's own type stripping cannot handle.
  let command: string;
  let args: string[];

  if (runner === 'bun') {
    command = 'bun';
    args = ['--watch', '--hot', entryPoint];
  } else {
    const tsx = resolveLocalTool(TOOL_ENTRIES.tsx);
    if (!tsx) {
      console.error('Running under Node requires tsx, which is not installed in this project.');
      console.error('Run: npm install -D tsx');
      console.error('(or install Bun — https://bun.sh — and veloce dev will use it automatically)');
      process.exit(1);
    }
    command = process.execPath;
    args = [tsx, 'watch', entryPoint];
  }

  console.log('Starting development server...');
  console.log(`Runtime: ${describeRunner(runner)}`);
  console.log(`Watching: ${options.watch || 'src'}`);
  console.log(`Port: ${options.port || 3000}`);
  console.log('\nPress Ctrl+C to stop\n');

  const env = {
    ...process.env,
    NODE_ENV: 'development',
    PORT: options.port?.toString() || '3000',
  };

  // No `shell: true`: it concatenates rather than escapes the arguments (Node
  // warns about it as DEP0190) and the entry point is an absolute path that can
  // contain spaces. `shell` is only needed on Windows to resolve the `.cmd`
  // shims npm installs, so use the shim name directly instead.
  const child = spawn(command, args, {
    stdio: 'inherit',
    env,
    shell: false,
    windowsHide: true,
  });

  const cleanup = () => {
    console.log('\nShutting down development server...');
    child.kill('SIGTERM');
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  child.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      console.error(`Failed to start the development server: "${command}" was not found on PATH.`);
      console.error(
        runner === 'bun'
          ? 'Install Bun (https://bun.sh) or re-run with --runtime node.'
          : 'Node needs npm available to fetch tsx. Install tsx as a devDependency to avoid the download.'
      );
    } else {
      console.error('Failed to start development server:', error);
    }
    process.exit(1);
  });

  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`Development server exited with code ${code}`);
      process.exit(code);
    }
  });
}
