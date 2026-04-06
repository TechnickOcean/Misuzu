# solver-example-workspace example

This example starts a standalone `SolverWorkspace` and chats with its main `SolverAgent`.

## What it demonstrates

- Load provider mappings from `.misuzu/providers.json`.
- Resolve the first available model from configured proxy providers.
- Create (or reuse restored) main solver agent.
- Run an interactive CLI loop.

## Usage

1. Set required provider environment variables referenced in `.misuzu/providers.json`.
2. Run:

```bash
node --import tsx packages/misuzu-core/examples/solver-example-workspace/index.ts packages/misuzu-core/examples/solver-example-workspace
```

## CLI commands

- `/compact` compact context
- `/quit` exit
