# Misuzu Codebase Guidelines for AI Agents

> **Comprehensive development guidelines for maintaining code quality and consistency in Misuzu.**

## Table of Contents

1. [Build and Test Commands](#build-and-test-commands)
2. [Code Style Guidelines](#code-style-guidelines)
3. [Naming & Structure](#naming--structure)
4. [Error Handling](#error-handling)
5. [Testing Patterns](#testing-patterns)
6. [Monorepo Structure](#monorepo-structure)
7. [Vite+ Toolchain](#vite-toolchain)
8. [Development Workflow](#development-workflow)
9. [Common Tasks](#common-tasks)
10. [Troubleshooting](#troubleshooting)
11. [Agent Checklist](#agent-checklist)

---

## Build and Test Commands

### Setup and Validation

| Command              | Description                                              |
| -------------------- | -------------------------------------------------------- |
| `vp install`         | Install dependencies (run after pulling changes)         |
| `vp check`           | Run format, lint, and TypeScript type checks             |
| `vp check --fix`     | Auto-fix formatting and linting issues                   |
| `vp test`            | Run all tests                                            |
| `vp test <file>`     | Run single test file (e.g., `vp test container.test.ts`) |
| `vp test --watch`    | Run tests in watch mode                                  |
| `vp test --coverage` | Run tests with coverage report                           |
| `vp build`           | Build monorepo packages (runs `vp pack` for packages)    |
| `vp run ready`       | Complete validation: format, lint, test, and build       |

### Per-Package Commands

When in a package directory (e.g., `packages/misuzu-core`):

| Command                | Description                                 |
| ---------------------- | ------------------------------------------- |
| `vp pack`              | Build TypeScript library with `.d.ts` files |
| `vp pack --watch`      | Build with file watching                    |
| `vp lint --type-aware` | Type-aware linting with full type checking  |
| `vp dev`               | Start development server (for apps)         |

### Running Commands from Root

```bash
# Format code (all packages)
vp fmt

# Run linting (all packages)
vp lint

# Run tests for all packages
vp run test -r

# Build all packages
vp run build -r

# Run specific package
vp run test -- packages/misuzu-core
```

---

## Code Style Guidelines

### TypeScript & Formatting

**Formatting Rules:**

- **No semicolons** - Configured with `semi: false`
- **Tab size**: 2 spaces (configured in project)
- **Quote style**: Single quotes for strings
- **Trailing commas**: Include trailing commas in multi-line constructs
- **Line length**: Keep lines reasonably sized (~100 characters)

**Type Safety:**

- **Strict types**: `strict: true` enforced everywhere
- **No `any`**: Use specific types instead of `any`
- **No implicit `any`**: TypeScript catches these with strict mode
- **Explicit returns**: Specify return types for functions where not obvious
- **Module syntax**: ES modules only (`import`/`export`), never `require()`
- **Extensions**: Always include `.ts` extension in TypeScript imports
- **Type imports**: Use `import type` for type-only imports

**Example:**

```typescript
// ✓ Good
import type { Config } from './types.ts'
import { createContainer } from './container.ts'

export interface AppConfig {
  debug: boolean
  timeout: number
}

export function createApp(config: AppConfig): App {
  return new App(config)
}

// ✗ Bad
import * as everything from './types'
import { createContainer } = require('./container.ts')

export function createApp(config: any): any {
  // ...
}
```

### Naming & Structure

**File Names:**

- Files: Use `kebab-case` for non-component files
- Examples: `base-tools.ts`, `di-container.ts`, `request-handler.ts`
- Components: Use `PascalCase` for Vue/React components: `UserProfile.vue`
- Tests: Use `.test.ts` suffix: `container.test.ts`

**Classes:**

- Use `PascalCase` for class names
- Example: `class Container {}`, `class FeaturedAgent {}`
- Use clear, descriptive names

**Interfaces:**

- Use `PascalCase` for interface names
- Optionally prefix with `I` for clarity (not required)
- Example: `interface FeaturedAgentOptions {}`, `interface ContainerConfig {}`

**Functions & Methods:**

- Use `camelCase` for function names
- Examples: `createContainer()`, `registerSingleton()`, `getUserById()`
- Use action verbs: `create`, `get`, `set`, `handle`, `process`

**Constants:**

- `UPPER_SNAKE_CASE` for exported module constants
- Examples: `export const MAX_TIMEOUT = 5000`, `export const DEFAULT_CONFIG = {}`
- Private constants: also `UPPER_SNAKE_CASE`

**Variables:**

- `camelCase` for variables and properties
- Examples: `let userCount = 0`, `const apiUrl = ''`

---

## Error Handling

### Error Messages

- **Use descriptive messages** with context
- **Include relevant data** in error messages when helpful
- **Never expose sensitive information** (passwords, tokens, etc.)
- **Always throw** `Error` or specific error types, never raw strings

**Good vs. Bad Examples:**

```typescript
// ✓ Good - Descriptive with context
throw new Error(`Missing dependency for token: ${String(token.description)}`)

// ✗ Bad - Too generic
throw new Error("Error")

// ✗ Bad - Throws raw string
throw "Something went wrong"

// ✓ Good - Specific error type
class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ValidationError"
  }
}

// ✓ Good - Safe, doesn't expose internals
throw new Error("Failed to process request. Please contact support.")
```

### Error Testing

- Test both success and error cases
- Test specific error messages
- Test error recovery paths

```typescript
describe("createContainer", () => {
  test("creates container successfully", () => {
    const container = createContainer()
    expect(container).toBeDefined()
  })

  test("throws error when config is invalid", () => {
    expect(() => {
      createContainer({ timeout: -1 })
    }).toThrow("Invalid timeout value")
  })
})
```

---

## Testing Patterns

### Import Convention

```typescript
// ✓ Correct - Always use vite-plus/test
import { describe, expect, test } from "vite-plus/test"

// ✗ Wrong - Never import directly from vitest
import { describe, expect, test } from "vitest"
```

### Test Organization

```typescript
describe("ClassName", () => {
  describe("methodName", () => {
    test("resolves singleton dependencies only once", () => {
      // Arrange
      const container = createContainer()

      // Act
      const instance1 = container.resolve("service")
      const instance2 = container.resolve("service")

      // Assert
      expect(instance1).toBe(instance2)
    })

    test("throws error when dependency not found", () => {
      const container = createContainer()

      expect(() => {
        container.resolve("unknown")
      }).toThrow("Dependency not found")
    })
  })
})
```

### Test Best Practices

- **Descriptive names**: Use clear, specific test descriptions
- **AAA Pattern**: Arrange, Act, Assert
- **One assertion per test**: Generally (exception: related assertions)
- **Test both happy and sad paths**: Success and error cases
- **Keep tests focused**: Test one thing per test
- **Isolated tests**: Tests should not depend on each other
- **Clear setup/teardown**: Use `beforeEach`/`afterEach` when needed

### File Naming

- Test files: Use `.test.ts` suffix
- Example: `container.test.ts`, `request-handler.test.ts`
- Place test files near the code they test

---

## Monorepo Structure

### Directory Layout

```
misuzu/
├── apps/                              # Applications (private packages)
│   ├── misuzu-web/                   # Vue.js web application
│   │   ├── src/
│   │   │   ├── pages/                # Page components
│   │   │   ├── components/           # Reusable components
│   │   │   ├── composables/          # Vue composition functions
│   │   │   ├── stores/               # Pinia state stores
│   │   │   └── server/               # Server code (SSR, endpoints)
│   │   └── package.json
│   └── ...
│
├── packages/                          # Published libraries
│   ├── misuzu-core/                  # Core library
│   │   ├── src/
│   │   │   ├── index.ts              # Main entry point
│   │   │   ├── [feature]/            # Feature directories
│   │   │   │   ├── index.ts
│   │   │   │   ├── types.ts
│   │   │   │   └── *.test.ts
│   │   │   └── utils/                # Shared utilities
│   │   ├── dist/                     # Compiled output
│   │   └── package.json
│   └── ...
│
├── tools/                             # Internal development tools
├── examples/                          # Example code
├── plugins/                           # Vite+ plugins
│
├── .github/                           # GitHub configuration
│   ├── ISSUE_TEMPLATE/
│   └── PULL_REQUEST_TEMPLATE.md
│
├── package.json                       # Root workspace configuration
├── pnpm-workspace.yaml               # Workspace definition
├── vite.config.ts                    # Root Vite configuration
├── tsconfig.json                     # Root TypeScript configuration
├── pnpm-lock.yaml                   # Dependency lock file
└── README.md                         # Project documentation
```

### Package Configuration

Each package has:

- `package.json` - Package metadata and scripts
- `vite.config.ts` - Build configuration
- `tsconfig.json` - TypeScript configuration
- `src/` - Source code
- `dist/` - Compiled output (for published packages)

### Dependency Management

- **Workspace**: Managed via `pnpm-workspace.yaml`
- **Version Catalog**: `package.json` has a `catalog` field for pinned versions
- **Lock File**: `pnpm-lock.yaml` ensures reproducible installs
- **Internal Dependencies**: Use `workspace:*` for inter-package dependencies

---

## Vite+ Toolchain

### Overview

Vite+ is a unified CLI tool bundling:

- **Vite** - Build tool and dev server
- **Rolldown** - JavaScript bundler
- **Vitest** - Unit testing framework
- **tsdown** - TypeScript library bundler
- **Oxlint** - Fast JavaScript linter
- **Oxfmt** - Code formatter

### Key Commands

```bash
# View all available commands
vp

# Code quality
vp check              # Format + lint + type check
vp check --fix       # Auto-fix format and lint
vp fmt               # Format only
vp lint              # Lint only
vp lint --type-aware # Lint with type checking (already enabled)

# Building
vp build                 # Build with Vite
vp pack                  # Build TypeScript library
vp pack --watch         # Build with watch mode

# Testing
vp test                  # Run all tests
vp test <file>          # Run specific test
vp test --watch         # Watch mode
vp test --coverage      # Generate coverage

# Development
vp dev                   # Start dev server

# Dependencies
vp add <package>        # Add dependency
vp remove <package>     # Remove dependency
vp update <package>     # Update dependency
```

### Critical Rules

**NEVER:**

- Use `npm install`, `yarn install`, or `pnpm install` directly
- Install Vitest, Oxlint, or tsdown separately (bundled with Vite+)
- Import directly from `vitest` in tests

**ALWAYS:**

- Use `vp` CLI commands instead of calling tools directly
- Import test utilities from `vite-plus/test`
- Import build config from `vite-plus`
- Check that Vite+ is installed: `vp --version`

### Configuration Files

**Root `vite.config.ts`:**

```typescript
// ✓ Correct
import { defineConfig } from "vite-plus"

export default defineConfig({
  // configuration
})

// ✗ Wrong
import { defineConfig } from "vite"
```

**Per-package `vite.config.ts`:**

- Should reference the package-specific configuration
- Inherits settings from root where applicable
- Can override for specific needs

---

## Development Workflow

### Before Starting

1. **Sync with upstream**

   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Install dependencies**

   ```bash
   vp install
   ```

3. **Verify environment**
   ```bash
   vp run ready
   ```

### During Development

1. **Watch for changes**

   ```bash
   # Option 1: Watch specific package
   cd packages/misuzu-core
   vp pack --watch

   # Option 2: Watch tests
   vp test --watch
   ```

2. **Check code quality regularly**

   ```bash
   vp check
   ```

3. **Fix issues automatically**
   ```bash
   vp check --fix
   ```

### Before Committing

1. **Run full validation**

   ```bash
   vp run ready
   ```

2. **Review changes**

   ```bash
   git diff
   git status
   ```

3. **Commit with proper message**
   ```bash
   git add .
   git commit -m "feat(package): description"
   ```

---

## Common Tasks

### Adding a New Feature

1. Create feature branch: `git checkout -b feature/my-feature`
2. Implement feature with tests
3. Run `vp check --fix` to format and lint
4. Run `vp test` to ensure tests pass
5. Commit with meaningful message
6. Push and create pull request

### Fixing a Bug

1. Create bug branch: `git checkout -b fix/issue-number`
2. Write test that reproduces the bug
3. Fix the bug
4. Ensure test passes
5. Run `vp run ready` for full validation
6. Commit and push

### Adding a New Package

1. Create package directory: `mkdir packages/new-package`
2. Copy template from existing package
3. Update `package.json` with correct metadata
4. Add to `pnpm-workspace.yaml` if needed
5. Run `vp install` to update dependencies
6. Test: `cd packages/new-package && vp test`

### Running Tests for Changed Files

```bash
# Test only changed files
vp test --changed

# Test specific file
vp test src/container.test.ts

# Test with coverage
vp test --coverage
```

### Building for Production

```bash
# Build all packages
vp run build -r

# Build specific package
cd packages/misuzu-core
vp pack

# Verify builds
ls packages/misuzu-core/dist/
```

---

## Troubleshooting

### Issue: Dependencies not installed properly

**Solution:**

```bash
vp install
# or
rm -rf node_modules pnpm-lock.yaml
vp install
```

### Issue: Tests failing locally but passing in CI

**Possible causes:**

- Different Node.js version
- Missing environment variables
- Stale cache

**Solution:**

```bash
# Clear cache and reinstall
vp install

# Check Node version (should be >= 22.12.0)
node --version

# Check environment variables
env | grep -i node
```

### Issue: TypeScript errors that seem incorrect

**Solution:**

```bash
# Run type checker
vp check

# Clear TypeScript cache
rm -rf node_modules/.vite
vp install

# Run build
vp pack
```

### Issue: Changes not reflected during development

**Solution:**

```bash
# Restart dev server (Ctrl+C)
vp pack --watch

# Or full restart
rm -rf dist node_modules
vp install
vp pack
```

### Issue: Linting or formatting conflicts

**Solution:**

```bash
# Auto-fix all issues
vp check --fix

# If conflicts remain, check configuration
cat vite.config.ts | grep -A 10 "oxlint\|oxfmt"
```

### Issue: Module not found errors

**Possible causes:**

- Missing `.ts` extension in import
- Incorrect path
- File not exported from index.ts

**Solution:**

```typescript
// ✓ Correct - Include .ts
import { Container } from "./container.ts"

// ✗ Wrong - Missing extension
import { Container } from "./container"

// Check exports in index.ts
export { Container } from "./container.ts"
export type { Config } from "./types.ts"
```

---

## Agent Checklist

**Before making changes:**

- [ ] Run `vp install` after pulling latest changes
- [ ] Verify Node.js version >= 22.12.0: `node --version`
- [ ] Run `vp run ready` to ensure clean state

**During development:**

- [ ] Run `vp check` frequently
- [ ] Run `vp test` after implementing features
- [ ] Review code against style guidelines
- [ ] Add tests for new functionality
- [ ] Test error cases explicitly

**Before committing:**

- [ ] Run `vp check --fix` to format and lint
- [ ] Run `vp test` to ensure all tests pass
- [ ] Run `vp run ready` for complete validation
- [ ] Use conventional commit format
- [ ] Reference related issues in commit message

**For pull requests:**

- [ ] Ensure all GitHub checks pass
- [ ] Add description of changes
- [ ] Link related issues
- [ ] Request review from maintainers
- [ ] Address review feedback promptly

**Post-merge:**

- [ ] Delete feature branch
- [ ] Monitor for any CI/CD failures
- [ ] Help review related pull requests
