#!/usr/bin/env bun
// Release script for veloce-ts
// Handles version bumping, changelog updates, and git tagging

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

type ReleaseType = 'major' | 'minor' | 'patch';

interface PackageJson {
  version: string;
  [key: string]: any;
}

function parseVersion(version: string): [number, number, number] {
  const parts = version.split('.').map(Number);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

function bumpVersion(currentVersion: string, type: ReleaseType): string {
  const [major, minor, patch] = parseVersion(currentVersion);
  
  switch (type) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
  }
}

function updatePackageJson(newVersion: string): void {
  const packagePath = join(process.cwd(), 'package.json');
  const packageJson: PackageJson = JSON.parse(readFileSync(packagePath, 'utf-8'));
  
  packageJson.version = newVersion;
  
  writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + '\n');
  console.log(`✅ Updated package.json to version ${newVersion}`);
}

function updateChangelog(newVersion: string): void {
  const changelogPath = join(process.cwd(), 'CHANGELOG.md');
  let changelog = readFileSync(changelogPath, 'utf-8');
  
  const today = new Date().toISOString().split('T')[0];
  
  // Replace [Unreleased] with the new version
  changelog = changelog.replace(
    '## [Unreleased]',
    `## [Unreleased]\n\n## [${newVersion}] - ${today}`
  );
  
  // Update comparison links
  const repoUrl = 'https://github.com/AlfredoMejia3001/veloce-ts';
  changelog = changelog.replace(
    /\[Unreleased\]: .+/,
    `[Unreleased]: ${repoUrl}/compare/v${newVersion}...HEAD\n[${newVersion}]: ${repoUrl}/releases/tag/v${newVersion}`
  );
  
  writeFileSync(changelogPath, changelog);
  console.log(`✅ Updated CHANGELOG.md for version ${newVersion}`);
}

async function runCommand(command: string, args: string[]): Promise<boolean> {
  const proc = Bun.spawn([command, ...args], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  
  const exitCode = await proc.exited;
  return exitCode === 0;
}

async function gitCommitAndTag(version: string): Promise<void> {
  console.log('\n📝 Creating git commit and tag...');
  
  // Stage changes
  await runCommand('git', ['add', 'package.json', 'CHANGELOG.md']);
  
  // Commit
  await runCommand('git', ['commit', '-m', `chore: release v${version}`]);
  
  // Tag
  await runCommand('git', ['tag', '-a', `v${version}`, '-m', `Release v${version}`]);
  
  console.log(`✅ Created git commit and tag v${version}`);
  console.log('\n📌 To push the release, run:');
  console.log(`   git push && git push origin v${version}`);
}

async function release() {
  const args = process.argv.slice(2);
  const releaseType = args[0] as ReleaseType;
  
  if (!['major', 'minor', 'patch'].includes(releaseType)) {
    console.error('❌ Invalid release type. Use: major, minor, or patch');
    console.error('Usage: bun run scripts/release.ts <major|minor|patch>');
    process.exit(1);
  }
  
  console.log(`🚀 Starting ${releaseType} release...\n`);
  
  // Read current version
  const packageJson: PackageJson = JSON.parse(
    readFileSync(join(process.cwd(), 'package.json'), 'utf-8')
  );
  const currentVersion = packageJson.version;
  const newVersion = bumpVersion(currentVersion, releaseType);
  
  console.log(`📦 Current version: ${currentVersion}`);
  console.log(`📦 New version: ${newVersion}\n`);
  
  // Confirm with user
  console.log('This will:');
  console.log('  1. Update package.json version');
  console.log('  2. Update CHANGELOG.md');
  console.log('  3. Run tests');
  console.log('  4. Build the project');
  console.log('  5. Create git commit and tag');
  console.log('\nPress Ctrl+C to cancel, or Enter to continue...');
  
  // Wait for user confirmation
  await new Promise<void>((resolve) => {
    process.stdin.once('data', () => resolve());
  });
  
  // Update version files
  updatePackageJson(newVersion);
  updateChangelog(newVersion);
  
  // Run tests
  console.log('\n🧪 Running tests...');
  const testsPass = await runCommand('bun', ['test', '--run']);
  if (!testsPass) {
    console.error('❌ Tests failed. Aborting release.');
    process.exit(1);
  }
  console.log('✅ Tests passed\n');
  
  // Build
  console.log('🔨 Building project...');
  const buildSuccess = await runCommand('bun', ['run', 'build:prod']);
  if (!buildSuccess) {
    console.error('❌ Build failed. Aborting release.');
    process.exit(1);
  }
  console.log('✅ Build successful\n');
  
  // Git commit and tag
  await gitCommitAndTag(newVersion);
  
  console.log('\n🎉 Release preparation complete!');
  console.log('\nNext steps:');
  console.log('  1. Review the changes');
  console.log(`  2. Push: git push && git push origin v${newVersion}`);
  console.log('  3. Publish to npm: npm publish');
}

release().catch((error) => {
  console.error('❌ Release failed:', error);
  process.exit(1);
});
