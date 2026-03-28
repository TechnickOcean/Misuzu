# CLI Resume Flow & TUI Controls Design

## Problem

Current startup assumes the server always hosts an active Coordinator. There is no way for the CLI to:

1. Discover available workspaces when the server is idle (no coordinator loaded)
2. Select and resume a workspace from the CLI
3. Gracefully stop a solver (only abort exists; abort cancels without preserving intent)
4. Gracefully stop/shutdown the entire coordinator kernel

## Goals

- **Idle server mode**: Server can start without loading any workspace. CLI discovers this state and presents a workspace picker.
- **Resume from CLI**: User picks a workspace from a list or creates a new one. CLI sends a command to the server to load it.
- **Stop solver**: Persist solver state, then terminate. Distinct from abort (which discards).
- **Stop kernel**: Persist all coordinator + solver state, stop all solvers, release the coordinator. Server returns to idle.

## Architecture Overview

```
CLI                           Server
 |                             |
 |-- GET /health ------------->|  (no coordinator? coordinatorStatus="idle")
 |<-- { coordinatorStatus } ---|
 |                             |
 |  [if idle]                  |
 |-- GET /workspaces --------->|  (reads filesystem, no coordinator needed)
 |<-- { workspaces[] } --------|
 |                             |
 |  [user picks workspace]     |
 |-- POST /runtime/command --->|  command: load_workspace
 |   { workspaceDir }          |  --> Coordinator.resumeFromWorkspace(...)
 |<-- { ok } ------------------|  --> replace coordinator in RuntimeHost
 |                             |
 |  [normal dashboard flow]    |
 |-- GET /runtime/snapshot --->|
 |<-- { solvers, pool, ... } --|
```

## Server Changes

### 1. Make Coordinator optional in MisuzuRuntimeHost

**File**: `packages/misuzu-server/src/runtime.ts`

`MisuzuRuntimeHost` currently requires a `Coordinator` in its constructor. Change to accept `Coordinator | null`.

```ts
export interface MisuzuRuntimeHostOptions {
  workspacesRoot?: string
  replayLimit?: number
  startupEventType?: "runtime.started" | "runtime.resumed" | "runtime.idle"
  ensureModelAvailable?: (modelId: string) => Promise<void> | void
  onServerRestartRequested?: () => Promise<void> | void
  onCoordinatorChanged?: (coordinator: Coordinator | null) => void // NEW
}
```

When `coordinator` is null:

- `getSnapshot()` returns a minimal snapshot with `coordinatorStatus: "idle"`, empty model pool, empty solver list
- `listWorkspaces()` works as before (filesystem scan, no coordinator dependency)
- `executeCommand()` rejects all commands except `load_workspace`
- Event subscriptions work; `runtime.idle` event is published on startup

New methods on `MisuzuRuntimeHost`:

```ts
// Replace the active coordinator (used by load_workspace)
setCoordinator(coordinator: Coordinator | null): void

// Shut down the current coordinator (persist + stop solvers)
async shutdownCoordinator(): Promise<void>
```

`setCoordinator(null)` unsubscribes from old coordinator, clears solver subscriptions, publishes `runtime.idle`.

`setCoordinator(newCoordinator)` unsubscribes from old, subscribes to new, syncs solver subscriptions, publishes `runtime.resumed`.

### 2. New protocol commands

**File**: `packages/misuzu-server/src/protocol.ts`

Add to `RuntimeCommandPayloadMap`:

```ts
export interface LoadWorkspaceCommandPayload {
  workspaceDir: string
  autoContinueSolvers?: boolean
}

export interface SolverStopCommandPayload {
  solverId: string
}

export interface ShutdownCoordinatorCommandPayload {
  graceful?: boolean
}

// Add to RuntimeCommandPayloadMap:
load_workspace: LoadWorkspaceCommandPayload
solver_stop: SolverStopCommandPayload
shutdown_coordinator: ShutdownCoordinatorCommandPayload
```

### 3. New API endpoint (optional optimization)

**File**: `packages/misuzu-server/src/api.ts`

The existing `GET /health` and `GET /workspaces` are sufficient. Enhance `/health` to include coordinator status:

```ts
app.get("/health", (c) => {
  const snapshot = runtime.getSnapshot()
  return c.json({
    ok: true,
    protocolVersion: snapshot.protocolVersion,
    coordinatorStatus: snapshot.workspaceId ? "active" : "idle", // NEW
    workspaceId: snapshot.workspaceId,
    generatedAt: new Date().toISOString(),
  })
})
```

### 4. Snapshot changes

**File**: `packages/misuzu-server/src/protocol.ts`

Add to `RuntimeSnapshot`:

```ts
export interface RuntimeSnapshot {
  // ... existing fields ...
  coordinatorStatus: "active" | "idle" // NEW
}
```

When idle:

- `workspaceId` = `undefined`
- `modelPool` = `{ slots: [], available: 0, total: 0 }`
- `solvers` = `[]`
- `challengeQueue` = `[]`
- `urlPendingQueue` = `[]`
- `coordinatorStatus` = `"idle"`

### 5. Command handler for load_workspace

**File**: `packages/misuzu-server/src/runtime.ts`

```ts
case "load_workspace":
  return await this.executeLoadWorkspace(request)
```

```ts
private async executeLoadWorkspace(
  request: RuntimeCommandRequestFor<"load_workspace">,
): Promise<RuntimeCommandResponse> {
  const { workspaceDir, autoContinueSolvers = true } = request.payload

  // Validate workspace exists
  if (!existsSync(join(workspaceDir, "manifest.json"))) {
    return { ok: false, requestId: request.requestId, error: "workspace not found" }
  }

  // If a coordinator is already active, shut it down first
  if (this.coordinator) {
    await this.shutdownCoordinator()
  }

  // Create model resolver from existing config
  // (Need access to modelMap from main.ts - pass via options)
  const coordinator = Coordinator.resumeFromWorkspace({
    workspaceDir,
    autoContinueSolvers,
    // ... other options from runtime host config
  })

  this.setCoordinator(coordinator)

  return {
    ok: true,
    requestId: request.requestId,
    payload: { workspaceId: coordinator.persistence.readManifest().id },
  }
}
```

### 6. Command handler for solver_stop

**File**: `packages/misuzu-server/src/runtime.ts`

```ts
case "solver_stop":
  return this.executeSolverStop(request)
```

```ts
private executeSolverStop(
  request: RuntimeCommandRequestFor<"solver_stop">,
): RuntimeCommandResponse {
  if (!this.coordinator) {
    return { ok: false, requestId: request.requestId, error: "no active coordinator" }
  }

  const solver = this.coordinator.solvers.get(request.payload.solverId)
  if (!solver) {
    return { ok: false, requestId: request.requestId, error: `solver not found: ${request.payload.solverId}` }
  }

  // Persist current solver state with status="stopped"
  this.coordinator.persistence.saveSolverState(request.payload.solverId, {
    ...this.coordinator.persistence.loadSolverState(request.payload.solverId),
    status: "stopped",
    updatedAt: new Date().toISOString(),
  })

  solver.abort()
  this.coordinator.solvers.delete(request.payload.solverId)

  // Release model slot
  this.coordinator.modelPool.releaseSlot(request.payload.solverId)

  // Dispatch queued challenges since a slot freed up
  void this.coordinator.dispatchQueuedChallenges()

  this.publish("server", "runtime.command.executed", {
    requestId: request.requestId ?? "",
    command: request.command,
    solverId: request.payload.solverId,
  })

  return { ok: true, requestId: request.requestId }
}
```

### 7. Command handler for shutdown_coordinator

**File**: `packages/misuzu-server/src/runtime.ts`

```ts
case "shutdown_coordinator":
  return await this.executeShutdownCoordinator(request)
```

```ts
private async executeShutdownCoordinator(
  request: RuntimeCommandRequestFor<"shutdown_coordinator">,
): Promise<RuntimeCommandResponse> {
  if (!this.coordinator) {
    return { ok: false, requestId: request.requestId, error: "no active coordinator" }
  }

  this.publish("server", "runtime.command.accepted", {
    requestId: request.requestId ?? "",
    command: request.command,
  })

  // 1. Abort all active solvers (their state is already persisted by the session recorder)
  for (const [solverId, solver] of this.coordinator.solvers) {
    solver.abort()
    this.coordinator.persistence.saveSolverState(solverId, {
      ...this.coordinator.persistence.loadSolverState(solverId),
      status: "stopped",
      updatedAt: new Date().toISOString(),
    })
  }

  // 2. Persist coordinator state
  this.coordinator.persistCoordinatorState()

  // 3. Close persistence
  this.coordinator.persistence.close()

  // 4. Remove coordinator from runtime
  this.setCoordinator(null)

  return {
    ok: true,
    requestId: request.requestId,
    payload: { message: "coordinator stopped, server is now idle" },
  }
}
```

### 8. Server main.ts idle mode

**File**: `packages/misuzu-server/src/main.ts`

Add `--idle` flag: when set, server starts without loading any workspace.

```ts
// In main():
const coordinator = options.idle
  ? null
  : options.workspace
    ? Coordinator.resumeFromWorkspace({ ... })
    : new Coordinator({ ... })

const runtime = new MisuzuRuntimeHost(coordinator, {
  workspacesRoot,
  replayLimit: options.eventBufferSize,
  startupEventType: options.idle
    ? "runtime.idle"
    : options.workspace
      ? "runtime.resumed"
      : "runtime.started",
  // ...
})
```

When `--idle`, the server starts and only serves `/health` and `/workspaces` until a `load_workspace` command arrives.

## CLI Changes

### 1. Startup resume flow

**File**: `apps/cli/src/index.ts`

After daemon check, before creating `MisuzuCliApp`:

```ts
async function main() {
  const options = parseCliOptions(process.argv.slice(2))
  let token = resolveToken(options)

  // ... existing daemon start logic ...

  const app = new MisuzuCliApp({ ...options, token })

  // Pre-TUI: check coordinator status
  const health = await app.checkHealth()

  if (health.coordinatorStatus === "idle") {
    // Enter workspace selection flow (still in terminal, before TUI starts)
    const workspaceDir = await app.promptWorkspaceSelection()
    if (workspaceDir === null) {
      // User chose to create new workspace -> send load_workspace with empty/new path
      // or start fresh coordinator
      await app.loadNewWorkspace()
    } else {
      await app.loadWorkspace(workspaceDir)
    }
  }

  await app.start() // normal TUI dashboard
}
```

### 2. Workspace selection in TUI

Use pi-tui's `SelectList` or render a text-based picker. The flow:

```
$ misuzu
Connecting to server at http://127.0.0.1:7788...
Server is idle. No active coordinator.

Available workspaces:
  1. misuzu-coordinator-20260328-090657-207e  (updated: 2026-03-28T12:00:00)
  2. misuzu-coordinator-20260327-150432-a1b2  (updated: 2026-03-27T18:30:00)
  3. [Create new workspace]

Select workspace (1-3):
```

Implementation: render a `Text` with options, capture single keypress to select. Since pi-tui may not have a built-in select list component pre-TUI, use simple stdin/stdout readline before TUI starts, OR render inside TUI with keyboard navigation.

**Recommended approach**: Do workspace selection inside TUI using a dedicated "workspace picker" mode:

```ts
class MisuzuCliApp {
  private mode: "workspace-picker" | "dashboard" = "dashboard"
  private workspaceOptions: WorkspaceSummary[] = []
  private workspaceCursor = 0

  private async enterWorkspacePicker() {
    this.mode = "workspace-picker"
    const { workspaces } = await this.client.listWorkspaces()
    this.workspaceOptions = workspaces
    this.workspaceCursor = 0
    this.renderWorkspacePicker()
  }

  private renderWorkspacePicker() {
    const lines: string[] = []
    lines.push(`${ANSI.bold}misuzu-cli${ANSI.reset}  No active coordinator. Select a workspace:`)
    lines.push("")

    for (let i = 0; i < this.workspaceOptions.length; i++) {
      const ws = this.workspaceOptions[i]
      const prefix = i === this.workspaceCursor ? `${ANSI.cyan}>${ANSI.reset}` : " "
      lines.push(
        `  ${prefix} ${ws.workspaceId}  ${ANSI.gray}(updated: ${ws.updatedAt ?? "n/a"})${ANSI.reset}`,
      )
    }

    const createPrefix =
      this.workspaceCursor === this.workspaceOptions.length ? `${ANSI.cyan}>${ANSI.reset}` : " "
    lines.push(`  ${createPrefix} ${ANSI.yellow}[Create new workspace]${ANSI.reset}`)
    lines.push("")
    lines.push(`${ANSI.gray}Up/Down to navigate, Enter to select, Ctrl+C to quit${ANSI.reset}`)

    this.dashboardText.setText(lines.join("\n"))
    this.tui.requestRender()
  }
}
```

Keyboard handling in workspace-picker mode:

- `Up/Down` or `j/k`: move cursor
- `Enter`: select workspace
- `Ctrl+C`: quit

### 3. New slash commands

**File**: `apps/cli/src/index.ts`

Add to `runSlashCommand`:

```ts
case "stop":
  await this.handleSolverStopCommand(rest)
  return

case "kernel":
  await this.handleKernelCommand(rest)
  return

case "resume":
  await this.enterWorkspacePicker()
  return
```

#### `/stop [solver-id]` - Stop a solver

Stops the selected (or specified) solver. Persists state with `status: "stopped"`, releases model slot.

```
/stop           # stops currently selected solver
/stop 7         # stops solver with id "7"
```

#### `/kernel stop` - Stop the coordinator

Gracefully shuts down the coordinator. All solvers are stopped, state is saved. Server returns to idle.

```
/kernel stop
```

After kernel stop, CLI should transition back to workspace picker mode.

#### `/resume` - Show workspace picker

Re-enters workspace selection flow. Useful after kernel stop or if user wants to switch workspace.

### 4. Client method additions

**File**: `apps/cli/src/index.ts` (in `MisuzuServerClient`)

```ts
async listWorkspaces(signal?: AbortSignal): Promise<{ ok: boolean; workspaces: WorkspaceSummary[] }> {
  const response = await fetch(`${this.serverUrl}/workspaces`, {
    method: "GET",
    headers: this.buildHeaders(),
    signal,
  })
  return (await response.json()) as { ok: boolean; workspaces: WorkspaceSummary[] }
}

async checkHealth(signal?: AbortSignal): Promise<{
  ok: boolean
  coordinatorStatus: "active" | "idle"
  workspaceId?: string
}> {
  const response = await fetch(`${this.serverUrl}/health`, {
    method: "GET",
    headers: this.buildHeaders(),
    signal,
  })
  return (await response.json()) as { ok: boolean; coordinatorStatus: "active" | "idle"; workspaceId?: string }
}
```

### 5. Autocomplete updates

Add new commands to autocomplete provider:

```ts
{ name: "stop", description: "Stop solver [id]" },
{ name: "kernel", description: "Kernel operations (stop)" },
{ name: "resume", description: "Select and resume workspace" },
```

### 6. Help text updates

Update `renderHelpText()` and `/help` output:

```
Shortcuts: ... | Ctrl+C quit | ...
Commands: ... /stop [id] /kernel stop /resume /quit
```

## TUI Display Improvements

### Dashboard enhancements

1. **Coordinator status indicator** in dashboard header:

   ```
   misuzu-cli  http://127.0.0.1:7788
   Connection: connected | Coordinator: active | Workspace: misuzu-coordinator-...
   ```

2. **Solver stop status display**: Show `stopped` solvers in a separate section (or dimmed) in the solver list.

3. **Queue depth warnings**: When queue > 10 items, show count in yellow/red.

### Workspace picker TUI

Full TUI-based workspace selection:

```
╔══════════════════════════════════════════════════╗
║  misuzu-cli - Select Workspace                  ║
║                                                  ║
║  > misuzu-coordinator-20260328-090657-207e      ║
║    (updated: 2026-03-28T12:00:00, 12 solvers)   ║
║                                                  ║
║    misuzu-coordinator-20260327-150432-a1b2      ║
║    (updated: 2026-03-27T18:30:00, 5 solvers)    ║
║                                                  ║
║    [Create new workspace]                        ║
║                                                  ║
║  Up/Down: navigate  Enter: select  Ctrl+C: quit ║
╚══════════════════════════════════════════════════╝
```

## Implementation Order

### Phase 1: Server idle mode (foundation)

1. Add `coordinatorStatus` to `RuntimeSnapshot` and `/health` response
2. Make `coordinator` nullable in `MisuzuRuntimeHost`
3. Add `setCoordinator()` and `shutdownCoordinator()` methods
4. Add `load_workspace`, `solver_stop`, `shutdown_coordinator` to protocol
5. Implement command handlers in runtime
6. Add `--idle` flag to server main.ts

### Phase 2: CLI resume flow

1. Add `checkHealth()` and `listWorkspaces()` to `MisuzuServerClient`
2. Implement workspace picker TUI mode
3. Wire startup flow: check health -> pick workspace if idle -> load -> dashboard
4. Add `/resume` command

### Phase 3: CLI stop controls

1. Add `/stop [id]` command (solver_stop)
2. Add `/kernel stop` command (shutdown_coordinator)
3. Post-kernel-stop: transition back to workspace picker
4. Update autocomplete and help text

### Phase 4: TUI polish

1. Enhanced dashboard header with coordinator status
2. Workspace picker visual improvements
3. Status line feedback for all new commands

## File Change Summary

| File                                         | Change                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------- |
| `packages/misuzu-server/src/protocol.ts`     | Add `coordinatorStatus` to snapshot, add 3 new command payloads                       |
| `packages/misuzu-server/src/runtime.ts`      | Nullable coordinator, `setCoordinator`, `shutdownCoordinator`, 3 new command handlers |
| `packages/misuzu-server/src/main.ts`         | Add `--idle` flag, conditional coordinator creation                                   |
| `packages/misuzu-server/doc/architecture.md` | Update API surface and startup flow docs                                              |
| `apps/cli/src/index.ts`                      | Workspace picker mode, 3 new commands, client methods, startup resume flow            |
| `apps/cli/src/ui-events.ts`                  | Add `runtime.idle` to important events                                                |

## Open Questions

1. **Model resolver for load_workspace**: When loading a workspace from CLI, the server needs to know which models to use. The current approach passes models via CLI args at startup. For `load_workspace`, models could come from: (a) the workspace manifest's `modelPool` field, (b) the server's startup `--models` args, or (c) the CLI command payload. Recommend: use manifest's model pool + any models specified at server startup, and allow override via the command payload.

2. **Concurrent clients during load_workspace**: If two clients try to load different workspaces simultaneously, the second should be rejected (coordinator already active). The command queue in `MisuzuRuntimeHost` serializes commands, so this is naturally handled - the second `load_workspace` will call `shutdownCoordinator()` first, stopping the first workspace. Consider whether this is desired or if we should reject instead.

3. **New workspace creation**: When user selects "[Create new workspace]", what happens? Option A: CLI prompts for CTF platform URL and creates a new workspace via a dedicated command. Option B: Server always has the ability to create new coordinators via `new Coordinator()`, exposed as a `create_workspace` command. Recommend Option B for consistency.
