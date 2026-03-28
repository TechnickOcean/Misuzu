# Persistence

Persistence provides durable workspace state for long CTF runs and restart/resume workflows.

## Storage Model

All runtime files are kept under:

`<launch-cwd>/.misuzu/workspaces/<workspace-id>/`

Core files:

- `manifest.json` (workspace metadata)
- `coordinator/state.json`
- `coordinator/session.jsonl`
- `coordinator/ENVIRONMENT.md`
- `coordinator/solvers/<solver-id>/...`

Per-solver files:

- `state.json`
- `session.jsonl`
- `ENVIRONMENT.md`
- `attachments/`
- `scripts/` (includes `poll-platform-updates.sh` and queue file)
- `Writeups.md`

## Behavioral Guarantees

- Solver workspace is created before solver starts
- `ENVIRONMENT.md` is the mutable source of truth for challenge environment data
- Session streams are append-only (`session.jsonl`)
- `session.jsonl` acts as both resumable context history and operational log
- Tool invocations are logged with sanitized parameter payloads (`tool_call` entries)
- State snapshots are replace-style (`state.json`)
- Resume can reconstruct coordinator + solver context from persisted files

## Runtime Components

## `SessionManager`

Purpose:

- Append and read session entries (`message`, `compaction`, `challenge_state`, `tool_call`)
- Rebuild agent context from session log

Relevant methods:

- `appendMessage(...)`
- `appendCompaction(...)`
- `appendChallengeState(...)`
- `readAll()`
- `buildContext()`
- `close()`

## `AgentSessionRecorder`

Purpose:

- Subscribes to agent events and flushes new messages into `SessionManager`
- De-duplicates persisted entries by content fingerprints

Relevant methods:

- `attach(agent)`
- `flush(messages)`

## `CompetitionPersistence`

Purpose:

- Owns workspace directory structure and file operations
- Manages coordinator and solver state/session access

Construction and open:

- `CompetitionPersistence.create(workspacesRoot, options)`
- `CompetitionPersistence.open(workspaceDir)`

Coordinator-level methods:

- `readManifest()` / `updateManifest(...)`
- `saveCoordinatorState(...)` / `loadCoordinatorState(...)`
- `initializeCoordinatorEnvironment(...)`

Solver-level methods:

- `ensureSolverWorkspace(options)`
- `getSolverSession(solverId)`
- `saveSolverState(...)` / `loadSolverState(...)`
- `readSolverEnvironment(...)` / `writeSolverEnvironment(...)`
- `appendSolverEnvironmentNote(...)`
- `updateSolverEnvironmentUrl(...)`
- `appendSolverWriteup(...)`
- `getSolverEnvironmentPath(...)` / `getSolverWriteupPath(...)`

Lifecycle:

- `close()` closes coordinator and solver sessions

## Workspace Helpers

- `createWorkspaceId(name, date?)`
- `defaultWorkspacesRoot(launchDir?)`

Backward-compatible aliases:

- `createCompetitionId`
- `defaultCompetitionsRoot`

## Resume Expectations

`Coordinator.resumeFromWorkspace(...)` relies on persistence files to restore:

- coordinator context
- model-slot state
- solver states and sessions
- challenge queue

If external ephemeral resources were in use (containers, temporary credentials), they may still require re-establishment after resume.

## Caller Guidance

- Keep authoritative mutable challenge facts in `ENVIRONMENT.md`
- Keep reproducible exploit path in `Writeups.md` and `scripts/`
- Use `state.json` for machine lifecycle state, not free-form notes
