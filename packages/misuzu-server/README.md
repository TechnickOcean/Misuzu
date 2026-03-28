# misuzu-server

`misuzu-server` is the daemon-side runtime host for Misuzu.

It keeps `Coordinator`/`Solver` alive independently from clients and exposes:

- HTTP APIs for snapshot and command
- SSE stream for realtime runtime events

Implementation uses Hono (`hono` + `@hono/node-server`).

Design doc: `doc/architecture.md`

Run daemon locally:

```bash
vp run start -- --model rightcode/gpt-5.4 --port 7788
```

Common flags:

- `--workspace <path>`: resume an existing workspace
- `--workspace-root <path>`: launch root for new workspace
- `--models a/b,c/d`: model pool IDs
- `--model-concurrency <n>`: per-model slot concurrency
- `--token-file <path>`: auth token file path

## Development

```bash
vp check
vp build
```
