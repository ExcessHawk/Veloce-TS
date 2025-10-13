#!/usr/bin/env bun
import { Command } from 'commander';
import { readFileSync } from 'fs';
import { join } from 'path';

// Get package.json version
const getVersion = (): string => {
  try {
    const packagePath = join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8'));
    return packageJson.version || '0.1.0';
  } catch {
    return '0.1.0';
  }
};

const program = new Command();

program
  .name('veloce')
  .description('A modern, fast web framework for TypeScript inspired by FastAPI')
  .version(getVersion(), '-v, --version', 'Display version number')
  .helpOption('-h, --help', 'Display help for command');

// Import and register subcommands
async function main() {
  const { registerNewCommand } = await import('./commands/new');
  const { registerDevCommand } = await import('./commands/dev');
  const { registerBuildCommand } = await import('./commands/build');
  const { registerGenerateCommand } = await import('./commands/generate');

  registerNewCommand(program);
  registerDevCommand(program);
  registerBuildCommand(program);
  registerGenerateCommand(program);

  // Parse arguments
  program.parse(process.argv);
}

main().catch((error) => {
  console.error('CLI error:', error);
  process.exit(1);
});
