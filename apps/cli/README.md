# misuzu-cli TUI

## Event View Policy

- Default focus is the coordinator timeline.
- The dashboard does not render all raw runtime events.
- Only important events are shown (`coordinator.*`, `runtime.command.*`, `error`, and key solver outcomes).
- Solver execution details are inspected in a dedicated solver tab, scoped to one solver at a time.

## Tab Workflow

- `coordinator` tab: operational control plane view.
- `solver` tab: inspect a selected solver's messages/tool lifecycle without global event noise.
- Solver tab follows the selected solver id (`/select`, `Alt+J`, `Alt+K`).
