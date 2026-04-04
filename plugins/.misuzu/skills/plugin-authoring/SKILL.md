---
name: plugin-authoring
description: Build a CTF platform plugin under plugins/ that matches Misuzu protocol, including contest binding, challenge APIs, flag submission flow, and runtime-only update polling.
allowed-tools: Read, Find, Grep, Edit, Write, Bash(curl:*), Bash(vp check), Bash(vp test)
---

# Plugin Authoring Skill (Misuzu)

Use this skill when adapting a CTF platform into a plugin under `plugins/`.

## Goal

Create a plugin that implements `plugins/protocol.ts` with minimal complexity and clear runtime boundaries:

- Plugin handles **platform API adaptation**.
- Runtime handles **submission rate limits, dedupe, scheduling, and notification routing**.
- Solver receives only safe, high-level runtime tools.

## Required output

At minimum, generate:

1. `plugins/<plugin-id>/index.ts` (adapter implementation)
2. `plugins/<plugin-id>/README.md` (config + endpoint notes + caveats)
3. Optional exports update in `plugins/index.ts`

Do not move runtime policy into the plugin.

## Workflow

### 1) Confirm protocol surface

Read `plugins/protocol.ts` and map each required method to expected platform endpoints:

- `setup`
- `ensureAuthenticated`
- `listContests`
- `bindContest`
- `listChallenges`
- `getChallenge`
- `submitFlagRaw`
- `pollUpdates`

Optional methods:

- `openContainer`
- `destroyContainer`

### 2) Discover API behavior

Prefer API over DOM scraping whenever possible.

- If login/captcha is required, prefer importing `plugins/utils/open-headed-auth.ts` in plugin `login()` and return captured cookie auth.
- Store captured `cookieHeader` into auth session state for subsequent API probing.
- Collect concrete examples for:
  - contest list response
  - challenge list response
  - challenge detail response
  - flag submit request/response
  - submission status endpoint
  - notices/update endpoint
  - container lifecycle endpoint(s)

### 3) Handle contest binding (important)

Always support multi-contest hosting:

- `auto`: choose active contest (`start <= now <= end`) or fallback to first.
- `id`: direct match.
- `title`: exact title match.
- `url`: parse contest ID from URL.

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
2. `ensureAuthenticated()`
3. `refreshAuth(session)`
4. `getAuthSession()`

Rules:

- For captcha-heavy platforms, support `manual` and `cookie` first.
- On protected API `401/403`, attempt one refresh and retry once.
- If still unauthorized, throw explicit re-auth required error so runtime can pause solver tasks.

### 6) Implement poll updates for runtime

`pollUpdates(cursor)` should:

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

### 8) Document caveats

In plugin README, explicitly document:

- auth constraints (manual/cookie/token)
- auth expiry behavior and re-login trigger
- known endpoint assumptions
- attachment behavior
- submission states observed
- container endpoint semantics

## Practical rules

- Keep adapter code deterministic and typed.
- Avoid hidden magic and platform-specific heuristics unless documented.
- Fail fast with descriptive errors when required fields are missing.
- Use the existing plugin implementations in `plugins/` as references.

## Done checklist

- `vp check` passes
- `vp test` passes
- README includes example config and limitations
- `bindContest` supports `auto/id/title/url`
- submit flow and update polling are both implemented and tested against real responses
