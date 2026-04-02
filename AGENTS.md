# Misuzu Codebase Guidelines for AI Agents

## Build and Test Commands

### Setup and Validation

- `vp install` - Install dependencies (run after pulling changes)
- `vp check` - Run format, lint, and TypeScript type checks
- `vp check --fix` - Auto-fix formatting and linting issues
- `vp test` - Run all tests
- `vp test <file>` - Run single test file (e.g., `vp test container.test.ts`)
- `vp test --watch` - Run tests in watch mode
- `vp build` - Build monorepo packages (runs `vp pack` for packages)
- `vp run ready` - Complete validation: format, lint, test, and build

### Per-Package Commands

When in a package directory (e.g., `packages/misuzu-core`):

- `vp pack` - Build TypeScript library with `.d.ts` files
- `vp pack --watch` - Build with file watching
- `vp lint --type-aware` - Type-aware linting with type checking enabled

## Code Style Guidelines

### TypeScript & Formatting

- **No semicolons**: Configure linter with `semi: false` (already set in vite.config.ts)
- **Strict types**: `strict: true` enforced; use explicit types over `any`
- **Module syntax**: ES modules only (`import`/`export`), no `require()`
- **Extensions**: Include `.ts` in import paths when importing TypeScript files
- **Imports**: Use `import type` for type-only imports; group: types, external deps, internal
- **No useless Type**: Do not mark function returning types unless TypeScript cannot infer it, do not write useless type guards.

### Naming & Structure

- **Files**: Use kebab-case for non-component files (e.g., `base-tools.ts`, `di-container.ts`)
- **Classes**: PascalCase (e.g., `Container`, `FeaturedAgent`)
- **Interfaces**: PascalCase, prefix with capital letter (e.g., `FeaturedAgentOptions`)
- **Functions**: camelCase (e.g., `createContainer`, `registerSingleton`)
- **Constants**: UPPER_SNAKE_CASE if exported module constants

### Error Handling

- Use descriptive error messages with context
- Example: `` `Missing dependency for token: ${String(token.description)}` ``
- Always throw `Error` or specific error types, not raw strings
- Test error cases explicitly (see container.test.ts for patterns)

### Testing Patterns

- Import from `vite-plus/test`, not `vitest`: `import { describe, expect, test } from "vite-plus/test"`
- Use descriptive test names: `"resolves singleton dependencies only once"`
- Test both success and error cases
- Keep tests focused and isolated
- File naming: `.test.ts` suffix for test files

### Monorepo Structure

- `packages/` - Published libraries (e.g., misuzu-core)
- `apps/` - Applications
- `examples/` - Example code in workspace catalog
- Each package has independent `tsconfig.json` and `vite.config.ts`
- Workspace uses pnpm with version catalog for dependency management

## Vite+ Toolchain

This project uses Vite+, a unified toolchain wrapping Vite, Rolldown, Vitest, tsdown, Oxlint, and Oxfmt via global `vp` CLI.

### Key Commands

- `vp` - View all commands
- `vp check` - Format + lint + type check
- `vp fmt` - Format with Oxfmt
- `vp lint` - Lint with Oxlint
- `vp pack` - Build libraries with type declarations
- `vp add/remove/update` - Manage dependencies

### Critical Rules

- **Never** use pnpm/npm/yarn directly; use `vp` wrappers
- **Never** install Vitest, Oxlint, or tsdown; they're bundled with Vite+
- **Always** import test utilities from `vite-plus/test`, not `vitest`
- **Always** import build config from `vite-plus`, not `vite`
- Type-aware linting enabled by default: `vp lint` includes type checking

## Agent Checklist

- [ ] Run `vp install` after pulling changes
- [ ] Run `vp check --fix` to format and lint code
- [ ] Run `vp test` to ensure tests pass
- [ ] Run `vp build` (or `npm run ready` for full validation)
