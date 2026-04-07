---
name: plugin-authoring
description: Build a CTF platform plugin in the built-in plugins workspace and register it in plugins/catalog.json for runtime selection.
allowed-tools: Read, Find, Grep, Edit, Write, Bash(curl:*), Bash(vp check), Bash(vp test)
---

# Plugin Authoring Skill (Misuzu)

Use this skill when adapting a CTF platform into a plugin under the built-in `packages/misuzu-core/plugins/` workspace.

## Goal

Create a plugin that implements protocol-compatible behavior with minimal complexity and clear runtime boundaries:

- Plugin handles **platform API adaptation**.
- Runtime handles **submission rate limits, dedupe, scheduling, and notification routing**.
- Solver receives only safe, high-level runtime tools.

## Required output

At minimum, generate:

1. `plugins/<plugin-id>/index.ts` (adapter implementation)
2. `plugins/<plugin-id>/README.md` (config + endpoint notes + caveats)
3. `plugins/catalog.json` contains an entry for `<plugin-id>`

Do not move runtime policy into the plugin.

## Workflow

### 1) Confirm protocol surface

Read `plugins/protocol.ts` and map each required method to expected platform endpoints:

- `setup`
- `login`
- `validateSession`
- `listContests`
- `listChallenges`
- `getChallenge`
- `submitFlagRaw`
- `pollUpdates`

Optional methods:

- `openContainer`
- `destroyContainer`

### 2) Discover API behavior

Prefer API over DOM scraping whenever possible.

- If login/captcha is required, use plugin-local helpers (for example `./utils.ts`) in plugin `login()` and return captured cookie auth.
- Store captured `cookieHeader` into auth session state for subsequent API probing.
- Collect concrete examples for:
  - contest list response
  - challenge list response
  - challenge detail response
  - flag submit request/response
  - submission status endpoint
  - notices/update endpoint
  - container lifecycle endpoint(s)

### 3) Keep plugin stateless (important)

Contest binding, auth session persistence, and retry strategy are handled by runtime core.

- Plugin receives `session` and `contestId` via context arguments.
- Plugin must not keep long-lived auth/contest state internally.
- Plugin should focus on endpoint calls and response mapping only.

### 4) Normalize challenge data

Map raw challenge fields into protocol fields:

- `requiresContainer` from challenge type
- `attachments` with kind:
  - `external_url` for offsite links
  - `direct_download` for direct file endpoints
- `container.entry` / `container.closeTime`
- `hints` normalized to plain strings

### 5) Implement submit flow correctly

Many platforms are async:

1. Submit returns an ID (or token).
2. Poll status endpoint until terminal status.

Return a normalized `SubmitResult` with:

- `submissionId` (if available)
- `status`
- `accepted`

Do not add brute-force retry loops here; runtime owns submit strategy.

### 5.1) Implement auth lifecycle

Implement protocol auth methods clearly:

1. `login(auth)`
2. `validateSession(session)`

Rules:

- Prioritize `manual` first so EnvironmentAgent can use an interactive flow to build/fix the plugin quickly.
- Add `credentials` mode only after manual flow is stable.
- On protected API `401/403`, throw `PlatformAuthError` so runtime can re-login and retry.

### 6) Implement poll updates for runtime

`pollUpdates({ session, contestId, cursor })` should:

- fetch notices/announcements/events
- produce sorted incremental updates
- return monotonic cursor (usually max notice id or timestamp)

This API is runtime-facing and should not be exposed directly to Solver tools.

### 7) Container lifecycle safety

Some platforms use one toggle endpoint for both create/destroy.

Implement `openContainer` and `destroyContainer` with post-action verification:

- read challenge detail before action
- trigger action if needed
- read challenge detail again
- validate resulting state (`instanceEntry` exists or cleared)

### 8) Register plugin in catalog

After implementation, ensure `plugins/catalog.json` has an entry:

- `id`: plugin id
- `name`: display name for workspace creation page
- `entry`: plugin entry path such as `<plugin-id>/index.ts`

Then users can select this plugin id in workspace creation/config pages and set `.misuzu/platform.json` accordingly.

### 9) Document caveats

In plugin README, explicitly document:

- auth constraints (manual/credentials and current support status)
- auth expiry behavior and re-login trigger
- known endpoint assumptions
- attachment behavior
- submission states observed
- container endpoint semantics

## Practical rules

- Keep adapter code deterministic and typed.
- Avoid hidden magic and platform-specific heuristics unless documented.
- Fail fast with descriptive errors when required fields are missing.
- Use existing implementations in `packages/misuzu-core/plugins/` as references.

## Done checklist

- `vp check` passes
- `vp test` passes
- README includes example config and limitations
- plugin is registered in `plugins/catalog.json`
- plugin methods are context-driven (`{ session, contestId, ... }`) and stateless
- submit flow and update polling are both implemented and tested against real responses
