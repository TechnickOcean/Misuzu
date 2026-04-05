# ctf-runtime-workspace example

This example starts a `CTFRuntimeWorkspace` with plugin code loaded from `.misuzu/platform-plugin`.

## Usage

1. Set required environment variables:
   - `RIGHTCODE_API_KEY` (or another provider configured in `.misuzu/providers.json`)
   - `NCTF_COOKIE` (cookie header string used by deployed platform plugin)
2. Ensure plugin code exists at `.misuzu/platform-plugin/index.ts` (recommended via EnvironmentAgent tool `deploy_platform_plugin`).
3. Run:

```bash
node --import tsx examples/ctf-runtime-workspace/index.ts examples/ctf-runtime-workspace
```

## Runtime config

Runtime config is read from `.misuzu/platform.json`.

Platform plugin code is loaded from `.misuzu/platform-plugin/index.ts`.

Strings in `$env:VAR_NAME` form are resolved from environment variables at startup.
