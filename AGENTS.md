# Misuzu Codebase Agent Instructions

This document provides instructions and guidelines for AI coding agents operating within the Misuzu repository. Adhere strictly to these rules to maintain code quality, consistency, and project standards.

## 1. Project Overview & Architecture

Misuzu is a TypeScript-based pnpm workspace monorepo. It consists of:

- **`apps/misuzu-web`**: A fullstack web application using Vue 3 (frontend), Tailwind CSS, shadcn-vue, Pinia, and Hono (Node.js backend).
- **`packages/misuzu-core`**: Core library and agent infrastructure.
- **`plugins/*` and `tools/*`**: Extensible CTF protocol plugins and utility tools.

The primary build, lint, and test tool across the repository is **`vite-plus`** (invoked as `vp`). Always use `pnpm` as the package manager.

## 2. Build, Lint, and Test Commands

We rely heavily on `vite-plus` (`vp`) for all primary repository scripts.

### 2.1 Testing

Testing is powered by `vp test` (which uses Vitest under the hood). Tests should be co-located with source files as `*.test.ts`.

- **Run all tests in a package**:
  ```bash
  vp test
  ```
- **Run all tests across the workspace**:
  ```bash
  vp run test -r
  ```
- **Run a single test file (CRITICAL FOR AGENTS)**:
  ```bash
  vp test path/to/file.test.ts
  ```
- **Run tests matching a specific pattern or test name**:
  ```bash
  vp test -t "should handle user input"
  ```
- **Run tests in watch mode**:
  ```bash
  vp test --watch
  ```

### 2.2 Linting & Formatting

The codebase uses `vp` for opinionated formatting (no semicolons) and type-aware linting. Always format your code before completing a task.

- **Check formatting and linting**:
  ```bash
  vp check
  ```
- **Fix formatting and lint rules**:
  ```bash
  vp check --fix
  ```
- **Run explicit formatter**:
  ```bash
  vp fmt
  ```

### 2.3 Building & Development

- **Build all workspace packages**:
  ```bash
  vp run build -r
  ```
- **Build a specific app or package** (from within its directory):
  ```bash
  vp build    # For apps (via Vite)
  vp pack     # For libraries (via vp pack)
  ```
- **Start Web Dev Server**:
  ```bash
  pnpm --filter misuzu-web dev:full
  ```

## 3. Code Style & TypeScript Guidelines

### 3.1 TypeScript & ESM (Crucial)

- The project strictly uses ECMAScript Modules (`"type": "module"`).
- **IMPORTANT: File Extensions in Imports**: Always use explicit `.ts` extensions when importing local TypeScript files.
  - _Correct_: `import { User } from "./user.ts"`
  - _Incorrect_: `import { User } from "./user"` or `import { User } from "./user.js"`
- Always prefix Node.js built-in modules with `node:`.
  - _Correct_: `import { resolve } from "node:path"`
  - _Incorrect_: `import { resolve } from "path"`

### 3.2 Formatting Rules

- **Semicolons**: Do NOT use semicolons (`semi: false` is configured).
- **Quotes**: Use double quotes for strings, per standard `vp fmt` configuration.
- Let `vp fmt` handle the rest. Do not argue with the formatter.

### 3.3 Naming Conventions

- **Files and Directories**: Use `kebab-case` for file and directory names (e.g., `workspace-manager.ts`, `event-bus.ts`).
- **Classes and Interfaces**: Use `PascalCase` (e.g., `EnvironmentAgent`, `ServerAppOptions`).
- **Variables, Functions, Methods**: Use `camelCase` (e.g., `createServerApp`, `registerApiRoutes`).
- **Constants**: Use `UPPER_SNAKE_CASE` for global, immutable constants (e.g., `ENVIRONMENT_STANDALONE_PROMPT`).

### 3.4 Error Handling

- Use structured error handling. Avoid silent failures.
- For Hono API endpoints, intercept errors and return consistent JSON structures:
  ```typescript
  app.onError((error, c) => {
    const message = error instanceof Error ? error.message : String(error)
    return c.json({ error: message }, 400)
  })
  ```
- Throw standard `Error` instances or custom classes extending `Error` for internal validation rather than returning `null` or `undefined` unexpectedly.

## 4. Framework Specific Guidelines

### 4.1 Vue & Frontend (`apps/misuzu-web`)

- Use the Vue 3 Composition API with `<script setup lang="ts">`.
- Use `shadcn-vue` for UI components. Before building custom UI, check if a shadcn-vue component exists.
- State management should be handled via Pinia.
- Styling is done exclusively via Tailwind CSS classes. Avoid custom CSS files unless absolutely necessary.
- Use `lucide-vue-next` for all icons.

### 4.2 Hono & Backend (`apps/misuzu-web/src/server`)

- Create modular routers. Do not stuff all endpoints into `app.ts`.
- Share protocol types between client and server via `src/shared/protocol.ts` to ensure type safety over boundaries (e.g., WebSockets or APIs).
- Keep API logic thin; push heavy business logic into isolated service classes (e.g., `WorkspaceManager`).

### 4.3 Monorepo Boundaries

- Import from packages via workspace links (e.g., `import { X } from "misuzu-core"`).
- Never use relative imports to reach out of a workspace package (e.g., `import { X } from "../../packages/misuzu-core/src/index.ts"` is forbidden).

## 5. Agent Workflow Rules

1. **Understand First**: Always read `package.json` and surrounding files to understand context before making changes. Search for existing utility functions before writing new ones.
2. **Self-Verification**: After making code changes, always run the relevant tests (`vp test <file>`) or typechecks (`vp check`). Do not submit code without verifying it compiles and passes existing checks.
3. **Paths**: Use absolute paths in all tools unless the tool natively handles relative workspace paths.
4. **No Assumptions**: Verify the existence of tools or dependencies before using them.
