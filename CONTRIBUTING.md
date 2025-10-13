# Contributing to veloce-ts

Thank you for your interest in contributing to veloce-ts! This document provides guidelines for contributing to the project.

## Development Setup

1. Clone the repository:
```bash
git clone https://github.com/AlfredoMejia3001/veloce-ts.git
cd veloce-ts
```

2. Install dependencies:
```bash
bun install
```

3. Run tests:
```bash
bun test
```

4. Build the project:
```bash
bun run build
```

## Development Workflow

1. Create a new branch for your feature or bugfix:
```bash
git checkout -b feature/your-feature-name
```

2. Make your changes and ensure tests pass:
```bash
bun test
bun run typecheck
```

3. Commit your changes following [Conventional Commits](https://www.conventionalcommits.org/):
```bash
git commit -m "feat: add new feature"
git commit -m "fix: resolve bug"
git commit -m "docs: update documentation"
```

4. Push your branch and create a pull request:
```bash
git push origin feature/your-feature-name
```

## Commit Message Guidelines

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `style:` - Code style changes (formatting, etc.)
- `refactor:` - Code refactoring
- `perf:` - Performance improvements
- `test:` - Test additions or modifications
- `chore:` - Build process or auxiliary tool changes

## Release Process

### For Maintainers

We use semantic versioning (MAJOR.MINOR.PATCH):

- **MAJOR**: Breaking changes
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes (backward compatible)

#### Creating a Release

1. Ensure all tests pass:
```bash
bun test
bun run typecheck
```

2. Run the release script:
```bash
# For a patch release (0.1.0 -> 0.1.1)
bun run release:patch

# For a minor release (0.1.0 -> 0.2.0)
bun run release:minor

# For a major release (0.1.0 -> 1.0.0)
bun run release:major
```

3. The release script will:
   - Update version in package.json
   - Update CHANGELOG.md
   - Run tests
   - Build the project
   - Create a git commit and tag

4. Review the changes and push:
```bash
git push && git push --tags
```

5. The GitHub Actions workflow will automatically:
   - Create a GitHub release
   - Publish to npm

#### Manual Release (if needed)

If you need to publish manually:

1. Build the production version:
```bash
bun run build:prod
```

2. Test the package:
```bash
bun run test:package
```

3. Publish to npm:
```bash
npm publish
```

## Testing

### Running Tests

```bash
# Run all tests
bun test

# Run tests in watch mode
bun test --watch

# Run tests with coverage
bun test --coverage
```

### Writing Tests

- Place tests in the `tests/` directory
- Use descriptive test names
- Follow the existing test patterns
- Ensure tests are isolated and don't depend on external state

### Testing Package Installation

Before releasing, test that the package can be installed correctly:

```bash
bun run test:package
```

This will:
- Pack the current package
- Create a temporary project
- Install the packed package
- Test ESM and CJS imports
- Verify tree-shaking works

## Code Style

- Use TypeScript for all code
- Follow the existing code style
- Run type checking: `bun run typecheck`
- Use meaningful variable and function names
- Add JSDoc comments for public APIs

## Documentation

- Update README.md for user-facing changes
- Update CHANGELOG.md for all changes
- Add JSDoc comments for new APIs
- Include code examples in documentation

## Pull Request Process

1. Ensure your code passes all tests and type checks
2. Update documentation as needed
3. Add entries to CHANGELOG.md under [Unreleased]
4. Request review from maintainers
5. Address any feedback
6. Once approved, a maintainer will merge your PR

## Questions?

If you have questions, please:
- Open an issue on GitHub
- Check existing issues and discussions
- Review the documentation

Thank you for contributing to veloce-ts! 🚀
