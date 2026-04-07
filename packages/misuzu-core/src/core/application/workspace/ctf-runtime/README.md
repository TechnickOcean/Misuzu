# ctf-runtime Guide (Plain English)

Chinese version: `README.zh-CN.md`

This file explains the module in simple terms. No deep framework jargon.

## What this module is

Think of `ctf-runtime` as a control center.

It does five jobs:

- talks to the CTF platform (login, contest, challenges, notices)
- runs and manages solvers
- schedules work in a queue
- manages model capacity
- saves state so restart can continue

Main class: `CTFRuntimeWorkspace` in `runtime-workspace.ts`.

## Folder map (quick)

```text
ctf-runtime/
  workspace.ts                  # public entry used by other modules
  runtime-workspace.ts          # main control flow
  factory.ts                    # creates workspace instances
  register-services.ts          # wires services together
  persistence.ts                # reads/writes state file
  state.ts                      # state shape definitions
  environment-runtime-state.ts  # EnvironmentAgent state helpers
  services/
    platform/                   # platform-facing logic
    scheduler/                  # queue and ranking policy
    model/                      # model pool
    solver/                     # solver workspaces
```

## Three important runtime stories

### 1) Normal startup

1. `factory.ts` creates the workspace.
2. `initPersistence()` loads previous state.
3. Runtime options are chosen in this order:
   - options passed by code
   - persisted runtime options
   - `platform.json`
4. If runtime options exist, `initializeRuntime()` starts platform runtime.

### 2) During normal running

- tasks enter queue
- idle solver picks next task
- challenge/notice sync updates state
- state writes are debounced (600ms) to reduce disk churn

### 3) Plugin not ready / plugin broken

- workspace can attach `EnvironmentAgent` first
- EnvironmentAgent chat context is saved
- later, platform runtime can run normally
- EnvironmentAgent state is still kept for future plugin fixes

This is the key fallback path.

## How EnvironmentAgent persistence works now

State now uses two separate slots:

- `environmentRuntimeState`: only EnvironmentAgent snapshot
- `runtimeState`: active non-environment runtime snapshot

Why this matters:

- saving platform runtime no longer wipes EnvironmentAgent history
- even after plugin runtime is active, you can reopen EnvironmentAgent context later

Where to check:

- schema: `state.ts`
- disk write: `persistence.ts`
- keep/restore logic: `runtime-workspace.ts`

## One-line mental model

Platform runtime is for production flow; EnvironmentAgent is a long-term repair fallback; both states are saved separately.

## Common review questions

### Why plugin-id match check before restoring snapshot?

To avoid restoring state from plugin A into plugin B.

### Why remove solved tasks on restore?

So solved challenges are not retried after restart.

### Why debounce persistence?

Queue and solver state can change very frequently.

### Why keep EnvironmentAgent state after switching runtime?

Because it is intentional recovery context, not temporary data.

## Fast review checklist

1. Is public API in `workspace.ts` still stable?
2. Is lifecycle order in `runtime-workspace.ts` still correct?
3. Did `state.ts` change, and is compatibility handled?
4. Does platform runtime persistence still keep `environmentRuntimeState`?
5. Did queue behavior (FIFO/cancel) change unexpectedly?

## Tests to read first

- `runtime-workspace.persistence.test.ts`
  - persistence/restore behavior
  - `platform.json` and `$env:` loading
  - EnvironmentAgent state kept across runtime switch

- `services/platform/runtime.test.ts`
  - platform initialization/integration behavior

- `services/scheduler/queue.test.ts`
  - FIFO and cancellation behavior

## Suggested reading order

1. `workspace.ts`
2. `runtime-workspace.ts`
3. `state.ts` + `persistence.ts`
4. `services/platform/hub.ts`
5. `services/scheduler/queue.ts`
