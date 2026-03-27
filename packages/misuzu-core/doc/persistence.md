# Persistence

Misuzu persists Coordinator and Solver runtime state under `.misuzu/` so a competition can be resumed and audited.

## Table of Contents

- [Goals](#goals)
- [Workspace Layout](#workspace-layout)
- [Lifecycle](#lifecycle)
- [Automation Polling Script](#automation-polling-script)
- [ENVIRONMENT.md Contract](#environmentmd-contract)
- [File Output Rules](#file-output-rules)
- [Failure Handling](#failure-handling)
- [Resume Expectations](#resume-expectations)

## Goals

1. Coordinator startup must create a dedicated workspace for the current run.
2. All persistence data lives under `.misuzu/`.
3. Each Solver gets a dedicated subdirectory under the Coordinator workspace.
4. Environment context is file-driven (`ENVIRONMENT.md`) and editable by Coordinator.
5. Solver artifacts (attachments/scripts/writeup) are deterministic and reproducible.

## Workspace Layout

Coordinator launch root is the CLI start directory. Persisted data is stored at:

```text
<launch-cwd>/.misuzu/workspaces/<coordinator-id>/
├── coordinator/
│   ├── state.json
│   ├── session.jsonl
│   ├── ENVIRONMENT.md
│   └── solvers/
│       ├── <solver-id>/
│       │   ├── state.json
│       │   ├── session.jsonl
│       │   ├── ENVIRONMENT.md
│       │   ├── attachments/
│       │   ├── scripts/
│       │   │   ├── poll-platform-updates.sh
│       │   │   ├── platform-updates.queue.md
│       │   │   └── README.md
│       │   └── Writeups.md
│       └── <solver-id>/...
└── manifest.json
```

Notes:

- `coordinator-id` identifies one Coordinator runtime/workspace.
- Every solver path is created by Coordinator at solver creation time.
- Solver directory path is stable for resume and auditing.

## Lifecycle

### 1) Coordinator startup

- Create `.misuzu/workspaces/<coordinator-id>/`.
- Initialize `manifest.json`, `coordinator/state.json`, and `coordinator/session.jsonl`.
- Initialize `coordinator/ENVIRONMENT.md` with platform-level environment and notices.

### 2) Solver creation

When Coordinator creates a solver:

- Create `coordinator/solvers/<solver-id>/` and required files.
- Create solver `ENVIRONMENT.md` from the latest challenge/environment metadata.
- Copy challenge attachments (if any) into `attachments/`.
- Create polling script scaffold in `scripts/poll-platform-updates.sh`.
- Set solver working directory to that solver folder.

### 3) Prompt construction

- Solver challenge/environment context must be sourced from `ENVIRONMENT.md`.
- Coordinator can update that file later without rebuilding solver identity.

### 4) Environment expiry / hints / platform notices

Because remote CTF environments can expire:

- Solver may notify Coordinator that environment URL is invalid/expired.
- Coordinator uses browser workflow to refresh environment metadata.
- Coordinator updates solver `ENVIRONMENT.md` (and coordinator-level `ENVIRONMENT.md` when needed).
- Platform hints/announcements for that challenge are appended into `ENVIRONMENT.md`.

### 5) Solve completion

- Solver writes exploit/repro scripts to `scripts/`.
- Solver submits candidate flag to Coordinator.
- If Coordinator confirms flag is correct, solver immediately writes reproducible steps to `Writeups.md`.

## Automation Polling Script

To avoid repetitive browser polling/hint checks, solver bootstrap creates `scripts/poll-platform-updates.sh`.

Intended timing:

1. `create_solver` completes.
2. Solver workspace is ready with ENV + attachments + scripts scaffold.
3. Solver/Coordinator can run the script manually (or under cron/systemd timer) using existing `bash` tool.

Contract:

- Input source is configured by environment variables (`SOURCE_URL`, optional `AUTH_HEADER`).
- New updates are appended to `scripts/platform-updates.queue.md`.
- Script also appends a compact marker to `ENVIRONMENT.md` so the agent sees state changes.
- Agent then uses existing tools (`notify_coordinator` / `update_solver_environment`) to promote changes into authoritative environment context.

## ENVIRONMENT.md Contract

`ENVIRONMENT.md` is the source of truth for mutable challenge context.

Recommended sections:

```markdown
# Challenge Environment

## Challenge

- id:
- name:
- category:

## Remote Environment

- current url:
- expires at:
- last checked at:

## Attachments

- attachments/<file>

## Hints and Announcements

- [timestamp] ...

## Operator Notes

- coordinator edits / overrides
```

Rules:

- Solver reads this file before acting on remote targets.
- Coordinator is the authority for updates.
- Expired URLs must be replaced in-file, not only mentioned in chat context.

## File Output Rules

- `attachments/`: immutable copies of platform attachments.
- `scripts/`: solver-generated scripts, PoCs, helpers.
- `scripts/poll-platform-updates.sh`: default polling scaffold for predictable platform updates.
- `scripts/platform-updates.queue.md`: append-only queue produced by polling script.
- `Writeups.md`: final reproducible solution, written only after flag correctness confirmation.
- `state.json`: machine-readable lifecycle state for resume.
- `session.jsonl`: append-only interaction timeline.

## Failure Handling

- **Flag rejected**: coordinator records rejection, keeps solver in solving state, and steers solver to continue.
- **Environment URL update fails validation**: coordinator does not overwrite `current url`, records reason in `ENVIRONMENT.md`, and asks for a fresh URL.
- **Attachment import fails**: failure is logged in `attachments/_download-errors.log`; solving may proceed with partial inputs.

## Resume Expectations

On resume, runtime reconstructs from files under `.misuzu/workspaces/<coordinator-id>/`:

- Coordinator state and message history from `coordinator/*`.
- Solver states and message histories from `coordinator/solvers/<solver-id>/*`.
- Effective challenge context from each solver's `ENVIRONMENT.md`.

Runtime API:

- Use `Coordinator.resumeFromWorkspace({ workspaceDir, ... })` to rehydrate coordinator state.
- Rehydrate solver states from `coordinator/solvers/<solver-id>/state.json` and `session.jsonl`.
- Optional `autoContinueSolvers` resumes solver loops immediately after reconstruction.

Ephemeral runtime resources (e.g. live container/network handles) may need re-establishment, but persisted files must be sufficient to continue solving safely.
