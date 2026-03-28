# misuzu-server Design

## Purpose

`misuzu-server` is the long-running runtime host for Misuzu.

- Owns one in-memory `Coordinator` runtime from `misuzu-core`
- Keeps solving even when TUI/Web clients disconnect
- Exposes attachable APIs for snapshot, command, and live events

## Package responsibilities

- Boot or resume runtime from workspace
- Normalize runtime state into transport-safe snapshot/event payloads
- Serialize write commands to runtime
- Fan out live events to many observers

Not in this package:

- TUI rendering/UX details
- CTF solving logic (belongs to `misuzu-core`)
- Multi-tenant auth

## Framework choice

v1 uses **Hono** on Node:

- API framework: `hono`
- Node adapter: `@hono/node-server`
- Event stream: Hono SSE (`streamSSE`)

Reason: simple routing model, first-class Web APIs, and low-friction SSE support for multi-client observers.

## API surface (v1)

### `GET /health`

Returns server liveness + protocol metadata.

### `GET /workspaces`

Returns resumable workspace summaries.

### `GET /runtime/snapshot`

Returns full runtime snapshot:

- model pool slots
- active solvers
- queued challenges
- url-pending challenges
- `lastSeq` for stream resume

### `POST /runtime/command`

Executes runtime mutation command:

- `coordinator_prompt`
- `create_solver`
- `update_solver_environment`
- `confirm_solver_flag`
- `solver_steer`
- `solver_abort`
- `solver_continue`
- `server_restart`
- `add_model_to_pool`
- `set_model_concurrency`

### `GET /runtime/events?after=<seq>`

SSE stream of `RuntimeEventEnvelope`.

- Server emits monotonic `seq`
- Client reconnects from `after=lastSeenSeq`
- Heartbeat event keeps idle connections alive

## Runtime host design

`MisuzuRuntimeHost` adapts `Coordinator` to transport APIs:

- Maintains monotonic event sequence + replay ring buffer
- Subscribes to coordinator and solver lifecycle events
- Builds `RuntimeSnapshot` from in-memory runtime + persisted solver state
- Executes commands through a serialized queue

## Event and replay model

Envelope:

```ts
type RuntimeJsonValue =
  | string
  | number
  | boolean
  | null
  | RuntimeJsonValue[]
  | { [key: string]: RuntimeJsonValue }

interface RuntimeEventEnvelope<TPayload extends RuntimeJsonValue = RuntimeJsonValue> {
  seq: number
  ts: string
  source: "server" | "coordinator" | "solver"
  type: string
  payload: TPayload
}
```

Server keeps an in-memory ring buffer for short-term replay and initial catch-up.

## Startup flow

`src/main.ts` boot sequence:

1. parse CLI/env options
2. register default proxy provider (RightCode) when available
3. create or resume `Coordinator`
4. create `MisuzuRuntimeHost`
5. start Hono server via `@hono/node-server`
6. persist/read auth token file under `.misuzu/runtime/<workspace-id>/token`

## Runtime integration with misuzu-core

- Runtime creation: `new Coordinator(...)`
- Runtime restore: `Coordinator.resumeFromWorkspace(...)`
- Source of truth: `.misuzu/workspaces/<workspace-id>/...`
- Command handling calls existing core APIs/tools directly to preserve behavior parity

## Security model (local-first)

- Bind to `127.0.0.1` by default
- Optional token auth via `x-misuzu-token` or `Authorization: Bearer <token>`

## Current code layout

- `src/protocol.ts`: transport contracts
- `src/runtime-host.ts`: runtime adapter interface
- `src/api.ts`: Hono routes + SSE implementation
- `src/server.ts`: Node server bootstrap (`@hono/node-server`)
- `src/runtime.ts`: Coordinator-to-RuntimeHost adapter
- `src/main.ts`: daemon entrypoint
- `src/index.ts`: public exports
