# Agents

This document describes agent responsibilities, externally relevant behavior, and public methods.
It intentionally avoids implementation walkthroughs.

## Agent Roles

## `FeaturedAgent` (base wrapper)

Purpose:

- Wraps `pi-agent-core` `Agent`
- Injects skill catalog into `systemPrompt`
- Enables context compaction through `transformContext`
- Bridges custom messages via `convertToLlm`
- Optionally records sessions via `AgentSessionRecorder`

Primary methods:

- `prompt(...)`
- `continue()`
- `steer(message)`
- `followUp(message)`
- `abort()`
- `waitForIdle()`
- `replaceMessages(messages)`
- `appendMessage(message)`
- `setTools(tools)`
- `setSystemPrompt(prompt)`
- `setModel(model)`
- `flushSession()`
- `detachSessionPersistence()`

State access:

- `state`
- `innerAgent`

## `Solver`

Purpose:

- Solves one challenge in one workspace
- Uses base tools + docker tools
- Reads mutable challenge context from `ENVIRONMENT.md`
- Reports candidate flags and reacts to coordinator feedback

Public methods:

- `solve(challenge: string)`
- `refreshEnvironmentContext(reason: string)`
- `notifyFlagConfirmed(message?: string)`

Key runtime behavior:

- Workspace is prepared before solving
- Prompt building includes current environment snapshot when available
- Solver continues to run independently after coordinator dispatch
- For attachment-heavy challenges, solver follows a local-first workflow before remote URL usage

## `Coordinator`

Purpose:

- Owns challenge scheduling and model-slot allocation
- Creates and restores solver runtimes
- Maintains authoritative environment updates
- Confirms/rejects flags and triggers writeup workflow

Public methods:

- `static resumeFromWorkspace(options)`
- `getCreateSolverTool()`
- `getUpdateSolverEnvironmentTool()`
- `getConfirmSolverFlagTool()`
- `confirmSolverFlag(challengeId, flag, correct, message?)`

Important public state:

- `modelPool`
- `workspaceRoot`
- `persistence`
- `solvers`
- `challengeQueue`

## Model Pool

`ModelPool` abstracts concurrency slots per model.

Methods:

- `acquire(solverId): string | null`
- `release(solverId): void`
- `available` (getter)
- `toJSON()`
- `static fromSlots(slots)`

Behavior:

- If no slot is available, challenge is queued
- Slot release triggers deterministic queue dispatch

## Lifecycle Rules

## Solver run end handling

- Stop reason is read from solver events (`turn_end` first, `agent_end` fallback)
- `stop` / `length`: solver remains `solving` (not finalized)
- `error` / `aborted`: solver becomes `failed` and is finalized
- already `solved`: finalized as solved

## Finalization

On finalize:

- release model slot
- remove solver from active map
- persist final solver state (`solved` or `failed`)
- attempt queued challenge dispatch if slots are available

## Tool Surface Exposed by Coordinator

- `create_solver`: allocate slot, initialize workspace, start solver asynchronously
- `update_solver_environment`: verify/apply URL or notes to solver environment file
- `confirm_solver_flag`: confirm/reject solver flag and update state/writeup flow
- `create_solver` without attachments requires a remote URL, otherwise challenge enters `url_pending`

## URL Pending Queue

- `url_pending` tracks challenges waiting for remote URL assignment and remote-environment slot
- Pending challenges activate in FIFO order once slot and URL conditions are met
- `update_solver_environment(updateType=environment_url)` can hydrate pending URLs and trigger activation

## Inter-Agent Communication

- Coordinator -> Solver: `prompt`, `steer`, `followUp`, `abort`
- Solver -> Coordinator:
  - custom messages (`flagResult`, `challengeUpdate`)
  - lifecycle events (`turn_end`, `agent_end`)

## Resume Contract

`Coordinator.resumeFromWorkspace(...)` restores:

- coordinator message context
- persisted model slots and queue
- solver sessions and states
- optional solver auto-continue (`autoContinueSolvers`)

Resumed runtime is expected to continue from persisted files without rebuilding workspace metadata manually.
