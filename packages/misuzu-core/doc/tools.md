# Tool System

This document describes tool contracts and behavior from an integrator perspective.
It is not a per-line implementation guide.

## Tool Families

## Base tools

- `shell` (bash/powershell)
- `read`
- `write`
- `edit`
- `find`
- `grep`

## CTF tools

- `docker_build`
- `docker_run`
- `docker_exec`
- `docker_stop`
- `docker_rm`

Runtime policy:

- Docker tools are injected per-solver, not globally forced for every challenge.
- Use docker sandbox only when local isolation/tooling is required (binary reversing, pwn services, heavy native tooling).
- For pure coordination tasks or lightweight web/misc analysis, avoid starting docker sandbox by default.

## Collections

- `baseTools`: read + shell + edit + write + find + grep
- `readOnlyTools`: read + grep + find
- `createBaseTools(cwd)` and `createReadOnlyTools(cwd)` create cwd-scoped instances

## Contract Model

All tools follow the `AgentTool` contract (`name`, `description`, typed `parameters`, async `execute`).

Behavioral expectations:

- Tools return structured `content` for LLM consumption
- Tools may include structured `details` for programmatic callers
- Cancellation is supported via `AbortSignal`

## Error Semantics

General rule:

- Functional failures should be surfaced clearly to the caller, with enough context to recover

Base tool behavior:

- `read`, `write`, `edit`, `find`, `grep`: throw for invalid operations (missing files, ambiguous edits, etc.)
- `shell`: does not rely on non-zero exit throwing; it returns explicit failure metadata
- `shell` uses hidden/background process execution so tool calls do not spawn interactive terminal windows

## `shell` Result Contract

`BashToolDetails` includes:

- `ok: boolean`
- `exitCode: number | null`
- `failure?: { kind: "non_zero_exit" | "timeout" | "aborted" | "runtime_error"; message: string }`
- `truncation?`
- `fullOutputPath?`

Implications:

- Non-zero command exit is represented as `ok: false` with `failure.kind = "non_zero_exit"`
- Timeout/abort/runtime exceptions are represented with dedicated failure kinds
- Callers can branch on `details.ok`/`details.failure` without process-level interruption

## Output Size Handling

All text-heavy tools use truncation utilities to bound output size.

- Head-truncation is used by file/search style outputs
- Tail-truncation is used by shell output (recent lines are most relevant)
- When full shell output is large, content may be written to a temp log and path returned in details

## Path and Mutation Safety

- Path resolution helpers normalize and anchor paths to current tool cwd
- Mutating file operations are serialized with `withFileMutationQueue` to reduce race conditions

## What to Rely On as a Caller

- Tool names and parameter schema are stable entry points
- `details` is the machine-readable place for control decisions
- Text content is optimized for LLM readability, not strict machine parsing

## Exported Tool API (from `src/index.ts`)

Factories and defaults:

- `createBashTool`, `bashTool`
- `createReadTool`, `readTool`
- `createWriteTool`, `writeTool`
- `createEditTool`, `editTool`
- `createFindTool`, `findTool`
- `createGrepTool`, `grepTool`

Notes:

- Runtime-facing agents must use `createBashTool(cwd)` so shell execution stays aligned with the agent workspace root.
- The exported `bashTool` singleton is process-cwd scoped and should only be used for simple local defaults.

Collections:

- `baseTools`, `readOnlyTools`

Tool contract types:

- `BashOperations`, `BashToolDetails`
- `ReadOperations`, `ReadToolDetails`
- `WriteOperations`
- `EditOperations`, `EditToolDetails`
- `FindOperations`, `FindToolDetails`
- `GrepToolDetails`

Utilities:

- `truncateHead`, `truncateTail`, `truncateLine`, `formatSize`, `TruncationResult`
- `withFileMutationQueue`
- `resolveToCwd`, `resolveReadPath`, `expandPath`
