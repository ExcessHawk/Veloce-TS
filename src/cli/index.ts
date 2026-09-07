/**
 * @module veloce-ts/cli
 * @description Entry point for the `veloce` / `veloce-ts` binary: the `new`, `generate`, `dev` and `build` commands (Commander).
 *
 * No shebang here: the executable is `bin/veloce.mjs` (`#!/usr/bin/env node`),
 * which imports this bundle. A `#!/usr/bin/env bun` line at the top of this file
 * was dead, and misleading about what actually runs the CLI.
 */
import { Command } from 'commander';
import { getFrameworkVersion } from './version.js';

const program = new Command();

program
  .name('veloce')
  .description('A modern, fast web framework for TypeScript inspired by FastAPI')
  .version(getFrameworkVersion(), '-v, --version', 'Display version number')
  .helpOption('-h, --help', 'Display help for command');

// Import and register subcommands
async function main() {
  const { registerNewCommand } = await import('./commands/new.js');
  const { registerDevCommand } = await import('./commands/dev.js');
  const { registerBuildCommand } = await import('./commands/build.js');
  const { registerGenerateCommand } = await import('./commands/generate.js');

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
