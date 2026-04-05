# environment-agent-workspace example

This example starts an `EnvironmentAgent` with built-in plugin workspace defaults.

## What it demonstrates

- Create `CTFRuntimeWorkspace` and bootstrap provider config.
- Create `EnvironmentAgent` through workspace factory (defaults to built-in `packages/misuzu-core/plugins`).
- Deploy selected plugin into workspace `.misuzu/platform-plugin` using `deploy_platform_plugin`.
- Interact with the agent in a CLI loop.

## Usage

1. Set required provider environment variables referenced in `.misuzu/providers.json`:
   - `RIGHTCODE_API_KEY` (or another configured provider key)
2. Run:

```bash
node --import tsx examples/environment-agent-workspace/index.ts examples/environment-agent-workspace
```

## Suggested prompt

Ask the environment agent:

`scaffold a plugin for a new platform named acme-ctf`

Then deploy it:

`deploy the acme-ctf plugin to this workspace`

Then continue with endpoint mapping and implementation based on the `plugin-authoring` skill.
