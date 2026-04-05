# environment-agent-workspace example

This example starts an `EnvironmentAgent` with built-in plugin workspace defaults.

## What it demonstrates

- Create `CTFRuntimeWorkspace` and bootstrap provider config.
- Create `EnvironmentAgent` through workspace factory (defaults to built-in `packages/misuzu-core/plugins`).
- Register plugin metadata in `plugins/catalog.json` so it appears in workspace plugin selection.
- Interact with the agent in a CLI loop.

## Usage

1. Set required provider environment variables referenced in `.misuzu/providers.json`:
   - `RIGHTCODE_API_KEY` (or another configured provider key)
2. Run:

```bash
node --import tsx packages/misuzu-core/examples/environment-agent-workspace/index.ts packages/misuzu-core/examples/environment-agent-workspace
```

## Suggested prompt

Ask the environment agent:

`scaffold a plugin for a new platform named acme-ctf`

Then register it:

`register acme-ctf in plugins/catalog.json with entry acme-ctf/index.ts`

Then continue with endpoint mapping and implementation based on the `plugin-authoring` skill.
After that, go back to workspace creation page and select `acme-ctf` from plugin list.
