import { Command } from 'commander';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

interface DevOptions {
  port?: number;
  watch?: string;
}

export function registerDevCommand(program: Command): void {
  program
    .command('dev')
    .description('Start development server with hot reload')
    .option('-p, --port <port>', 'Port to run the server on', '3000')
    .option('-w, --watch <path>', 'Additional paths to watch', 'src')
    .action(async (options: DevOptions) => {
      await startDevServer(options);
    });
}

async function startDevServer(options: DevOptions): Promise<void> {
  const entryPoint = join(process.cwd(), 'src', 'index.ts');

  // Check if entry point exists
  if (!existsSync(entryPoint)) {
    console.error('Error: src/index.ts not found');
    console.error('Make sure you are in a Veloce-TS project directory');
    process.exit(1);
  }

  console.log('Starting development server...');
  console.log(`Watching: ${options.watch || 'src'}`);
  console.log(`Port: ${options.port || 3000}`);
  console.log('\nPress Ctrl+C to stop\n');

  // Use Bun's built-in watch mode
  const bunArgs = ['--watch', '--hot', entryPoint];

  // Set environment variables
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    PORT: options.port?.toString() || '3000',
  };

  const bunProcess = spawn('bun', bunArgs, {
    stdio: 'inherit',
    env,
    shell: true,
  });

  // Handle process cleanup
  const cleanup = () => {
    console.log('\nShutting down development server...');
    bunProcess.kill('SIGTERM');
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  bunProcess.on('error', (error) => {
    console.error('Failed to start development server:', error);
    process.exit(1);
  });

  bunProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`Development server exited with code ${code}`);
      process.exit(code);
    }
  });
}
