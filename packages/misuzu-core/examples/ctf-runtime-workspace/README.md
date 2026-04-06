# ctf-runtime-workspace example

This example starts a `CTFRuntimeWorkspace` with plugin code loaded from built-in plugin catalog.
It also demonstrates derived solver workspaces sharing the runtime provider registry/bootstrap.
When no runtime is passed in code, workspace creation now auto-tries loading runtime options from `.misuzu/platform.json`.

## Usage

1. Set required environment variables:
   - `RIGHTCODE_API_KEY` (or another provider configured in `.misuzu/providers.json`)
   - `NCTF_COOKIE` (cookie header string used by `gzctf` plugin)
2. Ensure `.misuzu/platform.json` has a valid `pluginId` that exists in built-in `plugins/catalog.json`.
3. Run:

```bash
node --import tsx packages/misuzu-core/examples/ctf-runtime-workspace/index.ts packages/misuzu-core/examples/ctf-runtime-workspace
```

## Runtime config

Runtime config is auto-read from `.misuzu/platform.json` when no explicit `runtime` option is passed.

Platform plugin code is resolved from `plugins/catalog.json` by `pluginId`.

Strings in `$env:VAR_NAME` form are resolved from environment variables at startup.

## CLI commands

- `/challenges` list managed challenge ids
- `/sync` sync challenges once
- `/notice` sync notices once
- `/derive <challengeId|solverId>` derive a solver workspace and print whether providers are shared
- `/scheduler` print queue scheduler state
- `/quit` exit
