# Misuzu Web - Implementation Guide

This document explains the current web integration architecture for `misuzu-core`, how each requirement is mapped, and how to extend the implementation safely.

## Goals and Requirement Mapping

### 1) Homepage

Implemented in `src/client/views/HomeView.vue`.

- Reads persisted workspace registry from backend (`GET /api/workspaces`)
- Displays existing `CTFRuntimeWorkspace` and `SolverWorkspace`
- Uses a Vercel-inspired minimal monochrome layout
- Provides dark/light mode toggle
- Workspace creation now redirects to dedicated guided flow route

### 2) Create CTFRuntimeWorkspace

Implemented in `src/client/views/CreateWorkspaceView.vue` with step-by-step wizard.

- Plugin path:
  - Search plugins (`GET /api/plugins?query=...`)
  - Read plugin README (`GET /api/plugins/:pluginId/readme`)
  - Configure plugin options via structured form (no raw JSON)
  - Configure model pool via row-based form editor
  - Initialize runtime and sync first challenge set
  - Optional auto orchestration (FIFO enqueue behavior)
- No-plugin path:
  - Configure model pool first
  - Create runtime without plugin initialization
  - Create/attach `EnvironmentAgent`
  - Keep EnvironmentAgent tab resident in runtime page for future plugin maintenance

### 3) CTFRuntimeWorkspace page

Implemented with nested runtime routes:

- `src/client/views/runtime/RuntimeWorkspaceLayout.vue`
- `src/client/views/runtime/RuntimeOverviewView.vue`
- `src/client/views/runtime/RuntimeAgentView.vue`

- Left panel: Env/Solver agent list
- Main panel: active agent chat
- Runtime status cards: queue/challenge/solver summary
- Controls:
  - pause/start dispatch
  - sync challenges/notices
  - enqueue selected challenge

Performance strategy:

- Do **not** keep all agent full states live in memory on client
- Keep only:
  - runtime snapshot (light summary)
  - active agent detailed state
- Agent event stream triggers delayed active-agent state refresh (debounced pull)

### 4) SolverWorkspace page

Implemented in `src/client/views/SolverWorkspaceView.vue`.

- Standalone solver chat UI
- Not attached to runtime page structure
- websocket state sync for snapshot + agent events

### 5) Backend websocket (Hono, type-aware)

Implemented in:

- `src/server/main.ts`
- `src/server/app.ts`
- `src/server/routes/api.ts`
- `src/server/services/*`

Type-aware contract is centralized in `src/shared/protocol.ts` and consumed by both client and server.

## Project Structure

```
apps/misuzu-web/
  src/
    shared/
      protocol.ts                # shared request/response/ws types

    server/
      main.ts                    # node server bootstrap
      app.ts                     # hono app + websocket topic bridge
      routes/api.ts              # REST APIs
      di/container.ts            # backend DI container
      domain/tokens.ts           # backend DI tokens
      services/
        workspace-manager.ts     # core orchestration service
        workspace-registry-store.ts
        event-bus.ts

    client/
      main.ts
      App.vue
      router.ts
      styles.css
      services/
        workspace-api.ts         # REST client
        realtime-client.ts       # websocket client
      stores/
        workspace-registry.ts
        runtime-workspace.ts
        solver-workspace.ts
      composables/
        use-runtime-workspace.ts
        use-solver-workspace.ts
      views/
        HomeView.vue
        CreateWorkspaceView.vue
        SolverWorkspaceView.vue
        runtime/
          RuntimeWorkspaceLayout.vue
          RuntimeOverviewView.vue
          RuntimeAgentView.vue
      components/
        ui/                    # shadcn-vue generated components
        workspace/
```

## Backend Design

### Workspace Registry Persistence

- File: `apps/misuzu-web/.misuzu-web/workspace-registry.json`
- Service: `WorkspaceRegistryStore`
- Registry entry fields:
  - `id`, `kind`, `name`, `rootDir`, `createdAt`, `updatedAt`
  - runtime metadata: `initialized`, `pluginId`, `autoOrchestrate`

### Workspace Manager Responsibilities

`WorkspaceManager` handles:

- lazy load/create runtime and solver sessions
- bootstrap `misuzu-core` workspaces
- attach agent event subscriptions
- publish websocket snapshots/events
- runtime dispatch control (pause/resume)
- challenge synchronization and enqueue strategy

### REST API Surface

All APIs are under `/api`.

- `GET /workspaces`
- `POST /workspaces/runtime`
- `GET /workspaces/runtime/:workspaceId`
- `POST /workspaces/runtime/:workspaceId/runtime/init`
- `POST /workspaces/runtime/:workspaceId/dispatch/start`
- `POST /workspaces/runtime/:workspaceId/dispatch/pause`
- `POST /workspaces/runtime/:workspaceId/sync/challenges`
- `POST /workspaces/runtime/:workspaceId/sync/notices`
- `POST /workspaces/runtime/:workspaceId/queue/enqueue`
- `POST /workspaces/runtime/:workspaceId/agents/environment`
- `GET /workspaces/runtime/:workspaceId/agents/:agentId/state`
- `POST /workspaces/runtime/:workspaceId/agents/:agentId/prompt`
- `POST /workspaces/solver`
- `GET /workspaces/solver/:workspaceId`
- `GET /workspaces/solver/:workspaceId/agent/state`
- `POST /workspaces/solver/:workspaceId/prompt`
- `GET /plugins`
- `GET /plugins/:pluginId/readme`

### WebSocket Topics

Client connects to:

- `/ws?topic=registry`
- `/ws?topic=runtime:<workspaceId>`
- `/ws?topic=solver:<workspaceId>`

Server emits typed messages:

- `registry.updated`
- `runtime.snapshot`
- `solver.snapshot`
- `agent.event`
- `error`

## Frontend Design

### Router

Router is in `src/client/router.ts` with routes:

- `/` -> `HomeView`
- `/workspaces/new` -> `CreateWorkspaceView`
- `/runtime/:id/overview` -> runtime summary page
- `/runtime/:id/agent/:agentId` -> runtime agent chat page
- `/solver/:id` -> `SolverWorkspaceView`

`/runtime/:id` redirects to `/runtime/:id/overview`.

### App Shell

All pages are rendered inside a shared application shell:

- shell component: `src/client/components/layout/AppChrome.vue`
- heading primitive: `src/client/components/layout/PageHeading.vue`

The shell centralizes:

- top navigation (Home / New Workspace)
- theme toggle
- breadcrumb rendering from route metadata

### UI System (`shadcn-vue`)

`misuzu-web` now uses official `shadcn-vue` components generated by CLI.

- Config: `components.json`
- Tailwind config: `tailwind.config.ts`
- Core utility: `src/client/lib/utils.ts`
- UI components: `src/client/components/ui/**`

Used in pages/components:

- `button`, `card`, `input`, `textarea`, `badge`
- `select`, `tabs`, `scroll-area`, `separator`, `switch`

### Theme Mode

Theme mode is controlled via Vue composable and persisted in localStorage.

- composable: `src/client/composables/use-theme-mode.ts`
- toggle component: `src/client/components/ThemeToggle.vue`
- palette: pure monochrome (black/white + gray scale), no gradient background

### State Management (Pinia + composables)

- `workspace-registry` store: list/create registry entries, registry websocket feed
- `runtime-workspace` store: runtime snapshots, active agent state, runtime controls
- `solver-workspace` store: standalone solver state and chat actions

Composables wrap stores for page-level reusability:

- `useRuntimeWorkspace(workspaceId)`
- `useSolverWorkspace(workspaceId)`

### Client DI (`provide` / `inject` + `InjectionKey`)

The client now uses Vue native DI instead of a custom container.

- Injection definition: `src/client/di/app-services.ts`
- App bootstrap provider: `src/client/main.ts`
- Consumer entry points:
  - pages use `useAppServices()` when they need direct API calls
  - stores expose `bindServices(...)`; composables call this during setup

This follows Vue 3 recommended `provide`/`inject` usage and keeps service wiring explicit.

### Chat State Sync Strategy

To avoid full-state fan-out performance issues:

- server pushes lightweight `agent.event`
- client refreshes only active agent detailed state
- inactive agents keep summary-only data

## Core Integration Details (misuzu-core)

### Runtime Pause/Resume Controls

`misuzu-core` now supports queue-level dispatch control:

- pause dispatch
- resume dispatch
- detect paused state
- persist paused flag in queue snapshot

Related files:

- `packages/misuzu-core/src/core/application/workspace/ctf-runtime/services/queue.ts`
- `packages/misuzu-core/src/core/application/workspace/ctf-runtime/workspace.ts`
- `packages/misuzu-core/src/core/application/workspace/ctf-runtime/state.ts`

### Runtime Initialization Mode

`RuntimeInitOptions` supports `startPaused` so restored/new runtimes can start in paused mode and require manual start.

## Development Commands

From workspace root:

- install deps: `vp install`
- checks: `vp check --fix`
- test core: `vp run test -r`
- build all: `vp run build -r`

From web app:

- dev frontend: `vp run dev:client`
- dev backend: `vp run dev:server`
- frontend build: `vp run build:client`
- backend typecheck: `vp run build:server`

## Current Gaps and Follow-up Plan

The following improvements are planned next:

1. Add explicit API/docs examples for runtime init and no-plugin -> environment-agent -> plugin flow transitions.
2. Add integration tests for websocket topic snapshots + runtime control endpoints.
