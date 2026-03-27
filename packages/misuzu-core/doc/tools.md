# Tool System

Misuzu-core provides base tools for file operations and shell access, plus CTF-specific Docker tooling. All tools implement the `AgentTool` interface from `@mariozechner/pi-agent-core`.

## Table of Contents

- [Overview](#overview)
- [Tool Definition Pattern](#tool-definition-pattern)
- [Factory Pattern](#factory-pattern)
- [Pluggable Operations](#pluggable-operations)
- [AbortSignal Handling](#abort-signal-handling)
- [Output Truncation](#output-truncation)
- [Base Tools](#base-tools)
- [CTF Tools](#ctf-tools)
- [Tool Collections](#tool-collections)

## Overview

Every tool in misuzu-core follows the same structure:

1. **TypeBox schema** with `description` on every parameter
2. **Details type** for structured metadata (truncation info, diffs, etc.)
3. **Operations interface** for pluggable execution backends
4. **Factory function** that accepts a `cwd` parameter
5. **Default instance** using `process.cwd()`

This pattern enables tools to run locally or delegate execution to remote systems (for example Docker containers or SSH hosts) by swapping the operations implementation.

## Tool Definition Pattern

Each tool is defined as an `AgentTool` with TypeBox parameter schemas:

```typescript
import { Type } from "@sinclair/typebox"
import type { Static } from "@sinclair/typebox"
import type { AgentTool } from "@mariozechner/pi-agent-core"

// 1. Schema with descriptions on every field
const readSchema = Type.Object({
  path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
  offset: Type.Optional(
    Type.Number({ description: "Line number to start reading from (1-indexed)" }),
  ),
  limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
})

// 2. Derive TypeScript type from schema
export type ReadToolInput = Static<typeof readSchema>

// 3. Details type for structured metadata
export interface ReadToolDetails {
  truncation?: TruncationResult
}

// 4. Implement as AgentTool
const tool: AgentTool<typeof readSchema> = {
  name: "read",
  label: "read",
  description: "Read the contents of a file...",
  parameters: readSchema,
  async execute(toolCallId, params, signal, onUpdate) {
    // params is fully typed as ReadToolInput
    const { path, offset, limit } = params
    // ...
    return {
      content: [{ type: "text", text: fileContent }],
      details: { truncation },
    }
  },
}
```

### Error Handling

Tools throw errors for failures. The agent loop catches them and reports to the LLM as `toolResult` with `isError: true`:

```typescript
async execute(toolCallId, params, signal, onUpdate) {
  // Check if file exists
  try {
    await ops.access(absolutePath);
  } catch {
    throw new Error(`File not found: ${params.path}`);
  }

  // Check for multiple matches
  if (occurrences > 1) {
    throw new Error(
      `Found ${occurrences} occurrences of the text in ${params.path}. ` +
      `The text must be unique. Please provide more context.`
    );
  }
}
```

Error messages include context (file paths, occurrence counts) so the LLM can adjust its approach.

## Factory Pattern

Every tool has a factory function that accepts a working directory:

```typescript
// Factory function (accepts cwd for portability)
export function createReadTool(
  cwd: string,
  options?: ReadToolOptions,
): AgentTool<typeof readSchema> {
  // ... returns configured tool
}

// Default instance using process.cwd()
export const readTool = createReadTool(process.cwd())
```

This pattern enables:

- Creating tools scoped to a specific directory
- Passing custom operations for container/remote execution
- Testing with isolated working directories

```typescript
// Solver agent creates tools scoped to challenge directory
const tools = createBaseTools(resolve(process.cwd(), ".misuzu", "solvers", "challenge-42"))

// Coordinator creates tools with default cwd
const tools = createBaseTools(process.cwd())
```

## Pluggable Operations

Each mutating tool defines an `XxxOperations` interface that abstracts the I/O backend:

```typescript
export interface BashOperations {
  exec: (
    command: string,
    cwd: string,
    options: {
      onData: (data: Buffer) => void
      signal?: AbortSignal
      timeout?: number
      env?: NodeJS.ProcessEnv
    },
  ) => Promise<{ exitCode: number | null }>
}

export interface ReadOperations {
  readFile: (absolutePath: string) => Promise<Buffer>
  access: (absolutePath: string) => Promise<void>
}

export interface EditOperations {
  readFile: (absolutePath: string) => Promise<Buffer>
  writeFile: (absolutePath: string, content: string) => Promise<void>
  access: (absolutePath: string) => Promise<void>
}

export interface WriteOperations {
  writeFile: (absolutePath: string, content: string) => Promise<void>
  mkdir: (dir: string) => Promise<void>
}
```

### Default Implementations

Each operations interface has a default implementation using the local filesystem:

```typescript
const defaultReadOperations: ReadOperations = {
  readFile: (path) => fsReadFile(path),
  access: (path) => fsAccess(path, constants.R_OK),
}

const defaultEditOperations: EditOperations = {
  readFile: (path) => fsReadFile(path),
  writeFile: (path, content) => fsWriteFile(path, content, "utf-8"),
  access: (path) => fsAccess(path, constants.R_OK | constants.W_OK),
}
```

### Container Delegation

The Solver agent can swap operations to run tools inside a container:

```typescript
// Create container-backed operations
const containerOps: EditOperations = {
  readFile: (path) => dockerExec(`ctf-box`, `cat ${path}`),
  writeFile: (path, content) => dockerExec(`ctf-box`, `cat > ${path}`, content),
  access: (path) => dockerExec(`ctf-box`, `test -f ${path}`),
}

// Create tools that execute inside the container
const editTool = createEditTool("/challenge", { operations: containerOps })
```

This mechanism allows Solver agents to operate on challenge files inside isolated containers.

### Tool Operations Reference

| Tool    | Operations Interface | Methods                                                      |
| ------- | -------------------- | ------------------------------------------------------------ |
| `bash`  | `BashOperations`     | `exec(command, cwd, options)`                                |
| `read`  | `ReadOperations`     | `readFile(path)`, `access(path)`                             |
| `write` | `WriteOperations`    | `writeFile(path, content)`, `mkdir(dir)`                     |
| `edit`  | `EditOperations`     | `readFile(path)`, `writeFile(path, content)`, `access(path)` |
| `find`  | `FindOperations`     | `exists(path)`, `glob(pattern, cwd, options)`                |
| `grep`  | `GrepOperations`     | `isDirectory(path)`, `readFile(path)`                        |

## AbortSignal Handling

All tools support cancellation via `AbortSignal`. The pattern:

```typescript
async execute(toolCallId, params, signal, onUpdate) {
  return new Promise((resolve, reject) => {
    // 1. Check if already aborted before starting
    if (signal?.aborted) {
      reject(new Error("Operation aborted"));
      return;
    }

    let aborted = false;

    // 2. Register abort listener
    const onAbort = () => {
      aborted = true;
      reject(new Error("Operation aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    // 3. Perform async work
    (async () => {
      try {
        await doWork();
        if (aborted) return;           // Check after each async step

        await moreWork();
        if (aborted) return;

        // 4. Clean up and resolve
        signal?.removeEventListener("abort", onAbort);
        resolve({ content: [...], details: ... });
      } catch (error) {
        // 5. Clean up on error
        signal?.removeEventListener("abort", onAbort);
        if (!aborted) reject(error);
      }
    })();
  });
}
```

For bash, abort kills the entire process tree:

```typescript
const onAbort = () => {
  if (child.pid) killProcessTree(child.pid)
}
if (signal) {
  if (signal.aborted) onAbort()
  else signal.addEventListener("abort", onAbort, { once: true })
}
```

## Output Truncation

Large outputs are truncated to prevent context overflow. Two strategies:

### Head Truncation (read, find, grep)

Keeps content from the beginning, discards the rest:

```typescript
import { truncateHead } from "./utils/truncate"

const truncation = truncateHead(content)
if (truncation.truncated) {
  if (truncation.truncatedBy === "lines") {
    outputText += `\n\n[Showing lines ${start}-${end} of ${total}. Use offset=${nextOffset} to continue.]`
  } else {
    outputText += `\n\n[Showing lines ${start}-${end} of ${total} (${formatSize(limit)} limit). Use offset=${nextOffset} to continue.]`
  }
}
```

### Tail Truncation (bash)

Keeps the most recent output (end), discards older output:

```typescript
import { truncateTail } from "./utils/truncate"

const truncation = truncateTail(fullOutput)
if (truncation.truncated) {
  const startLine = truncation.totalLines - truncation.outputLines + 1
  outputText += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}. Full output: ${tempFilePath}]`
}
```

### Truncation Constants

| Constant               | Value         | Used By   |
| ---------------------- | ------------- | --------- |
| `DEFAULT_MAX_LINES`    | 100           | All tools |
| `DEFAULT_MAX_BYTES`    | 50,000 (50KB) | All tools |
| `GREP_MAX_LINE_LENGTH` | 500           | grep      |

### TruncationResult Type

```typescript
interface TruncationResult {
  content: string // The truncated content
  truncated: boolean // Whether truncation occurred
  truncatedBy: "lines" | "bytes" // What limit was hit
  outputLines: number // Lines in output
  totalLines: number // Total lines in original
  outputBytes: number // Bytes in output
  totalBytes: number // Total bytes in original
  maxLines?: number // Line limit applied
  maxBytes?: number // Byte limit applied
}
```

## Base Tools

### bash

Execute shell commands with streaming output and timeout support.

```typescript
const schema = Type.Object({
  command: Type.String({ description: "Bash command to execute" }),
  timeout: Type.Optional(
    Type.Number({ description: "Timeout in seconds (optional, no default timeout)" }),
  ),
})
```

**Details**: `{ exitCode: number | null, truncation?: TruncationResult, fullOutputPath?: string }`

- Streams stdout and stderr to a rolling buffer
- Writes to temp file once output exceeds `DEFAULT_MAX_BYTES`
- Non-zero exit code causes rejection (error includes output for context)
- Timeout kills the process tree
- Abort kills the process tree

### read

Read file contents with line-range support and image detection.

```typescript
const schema = Type.Object({
  path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
  offset: Type.Optional(
    Type.Number({ description: "Line number to start reading from (1-indexed)" }),
  ),
  limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
})
```

**Details**: `{ truncation?: TruncationResult }`

- Uses `resolveReadPath` for path resolution (handles macOS NFD, curly quotes, narrow no-break spaces)
- 1-indexed offset, honor user limit before applying `truncateHead`
- Truncation notice: `[Showing lines X-Y of N. Use offset=Z to continue.]`

### write

Write content to a file, creating parent directories automatically.

```typescript
const schema = Type.Object({
  path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
  content: Type.String({ description: "Content to write to the file" }),
})
```

- Uses `withFileMutationQueue` to serialize concurrent writes to the same file
- Auto-creates parent directories

### edit

Replace exact text in a file (surgical edits).

```typescript
const schema = Type.Object({
  path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
  oldText: Type.String({ description: "Exact text to find and replace (must match exactly)" }),
  newText: Type.String({ description: "New text to replace the old text with" }),
})
```

**Details**: `{ diff: string, firstChangedLine?: number }`

- Strips BOM before matching
- Normalizes line endings (CRLF → LF internally, restores original on write)
- Rejects if `oldText` not found: `Could not find the exact text in ${path}`
- Rejects if `oldText` found multiple times: `Found N occurrences. The text must be unique.`
- Rejects if replacement produces identical content
- Returns unified diff in details
- Uses `withFileMutationQueue` for concurrency safety

### find

Search for files matching a glob pattern.

```typescript
const schema = Type.Object({
  pattern: Type.String({ description: "Glob pattern to match files, e.g. '*.ts', '**/*.json'" }),
  path: Type.Optional(
    Type.String({ description: "Directory to search in (default: current directory)" }),
  ),
  limit: Type.Optional(Type.Number({ description: "Maximum number of results (default: 1000)" })),
})
```

**Details**: `{ truncation?: TruncationResult, resultLimitReached?: number }`

### grep

Search file contents with regex or literal matching.

```typescript
const schema = Type.Object({
  pattern: Type.String({ description: "Search pattern (regex or literal string)" }),
  path: Type.Optional(
    Type.String({ description: "Directory or file to search (default: current directory)" }),
  ),
  glob: Type.Optional(Type.String({ description: "Filter files by glob pattern, e.g. '*.ts'" })),
  ignoreCase: Type.Optional(
    Type.Boolean({ description: "Case-insensitive search (default: false)" }),
  ),
  literal: Type.Optional(
    Type.Boolean({
      description: "Treat pattern as literal string instead of regex (default: false)",
    }),
  ),
  context: Type.Optional(
    Type.Number({
      description: "Number of lines to show before and after each match (default: 0)",
    }),
  ),
  limit: Type.Optional(
    Type.Number({ description: "Maximum number of matches to return (default: 100)" }),
  ),
})
```

**Details**: `{ truncation?: TruncationResult, matchLimitReached?: number, linesTruncated?: boolean }`

## CTF Tools

### docker

Docker container management tools for building and running challenge services.

| Tool           | Parameters                                                          | Purpose                      |
| -------------- | ------------------------------------------------------------------- | ---------------------------- |
| `docker_build` | `dockerfile: string, tag: string, context?: string`                 | Build image from Dockerfile  |
| `docker_run`   | `image: string, command?: string, ports?: string, detach?: boolean` | Run a container              |
| `docker_exec`  | `container: string, command: string`                                | Execute in running container |
| `docker_stop`  | `container: string`                                                 | Stop a container             |
| `docker_rm`    | `container: string`                                                 | Remove a container           |

All docker tools use `BashOperations` under the hood.

## Built-in Skills

- `shared/playwright-cli`: available to both Coordinator and Solver
- `solver/requestrepo-oob`: available to Solver only

## Tool Collections

Pre-built collections for common agent configurations:

```typescript
// All base tools (for Solver agents)
export const baseTools: AgentTool<any>[] = [
  readTool,
  bashTool,
  editTool,
  writeTool,
  findTool,
  grepTool,
]

// Read-only tools (for Coordinator monitoring)
export const readOnlyTools: AgentTool<any>[] = [readTool, grepTool, findTool]

// Factory collections (accept cwd)
export function createBaseTools(cwd: string): AgentTool<any>[]
export function createReadOnlyTools(cwd: string): AgentTool<any>[]
```

### Agent Tool Assignments

| Agent       | Tools                                 |
| ----------- | ------------------------------------- |
| Solver      | `createBaseTools(cwd)` + docker tools |
| Coordinator | `createReadOnlyTools(cwd)` + bash     |
