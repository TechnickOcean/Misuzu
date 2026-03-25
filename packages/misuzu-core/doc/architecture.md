# Architecture

Misuzu-core is a CTF (Capture The Flag) agent framework built on [`@mariozechner/pi-agent-core`](https://github.com/mariozechner/pi-agent-core) and [`@mariozechner/pi-ai`](https://github.com/mariozechner/pi-ai). It provides a multi-agent system where a Coordinator assigns challenges to Solver agents that operate in isolated sandbox containers.

## Table of Contents

- [Overview](#overview)
- [Layer Diagram](#layer-diagram)
- [Data Flow](#data-flow)
- [Module Structure](#module-structure)
- [Documentation](#documentation)
- [Dependencies](#dependencies)

## Overview

Misuzu solves CTF challenges through a hierarchy of agents:

- **Coordinator**: Discovers challenges on the CTF platform, assigns them to Solver agents, receives flags, and submits them. Acts as the team manager.
- **Solver**: An expert CTF player agent that operates on individual challenges. Uses sandbox containers, Docker, and standard file/network tools to analyze and exploit challenges.
- **FeaturedAgent**: The base class both agents extend. Wraps `pi-agent-core`'s `Agent` with automatic skill loading, context compaction, and custom message type handling.

## Layer Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Coordinator Agent                        │
│  - Challenge discovery & assignment                             │
│  - Flag submission                                              │
│  - Solver supervision (steer, followUp, abort)                  │
│  Tools: bash, read, find, grep, requestrepo, docker             │
├─────────────────────────────────────────────────────────────────┤
│                         Solver Agent                            │
│  - Expert CTF player persona                                    │
│  - Sandbox interaction (exec, upload, download)                 │
│  - Docker container builds for challenge services                │
│  Tools: bash, read, write, edit, find, grep, sandbox, docker    │
├─────────────────────────────────────────────────────────────────┤
│                      FeaturedAgent (base)                       │
│  - Skill catalog (in system prompt)                             │
│  - Auto-compaction (transformContext hook)                      │
│  - Custom message types (convertToLlm)                          │
├─────────────────────────────────────────────────────────────────┤
│                  @mariozechner/pi-agent-core                     │
│  - Agent class (state, event loop, tool execution)              │
│  - AgentTool interface (TypeBox schemas, execute)               │
│  - AgentMessage, AgentEvent types                               │
│  - steer() / followUp() / prompt() / abort()                   │
├─────────────────────────────────────────────────────────────────┤
│                    @mariozechner/pi-ai                           │
│  - LLM provider abstraction                                     │
│  - Model types, streaming, API key resolution                   │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow

### Prompt Flow

```
User request
     │
     ▼
Coordinator.prompt(message)
     │
     ▼
┌────────────────────────────────────────────────────┐
│  transformContext(messages)                        │
│    └─ checkCompact() ─► compact() if needed        │
│  convertToLlm(messages)                            │
│    └─ custom messages ─► user messages             │
│  LLM call via pi-ai                                │
│    └─ system prompt + converted messages           │
└────────────────────────────────────────────────────┘
     │
     ▼
Assistant response (may contain tool calls)
     │
     ▼
Tool execution (parallel by default)
     │
     ▼
Tool results appended to context ──► next LLM turn
```

### Multi-Agent Communication

```
┌──────────────────────────────────────────────────────────────────┐
│                           Coordinator                            │
│                                                                  │
│  1. Fetch challenges from platform                               │
│  2. Sort by difficulty (easiest first)                           │
│  3. Assign to solvers via create_solver                          │
│                                                                  │
│  ┌──────────────┐  prompt/steer  ┌──────────────┐               │
│  │  Model Pool   │──────────────►│  Solver A    │               │
│  │  ┌─────────┐  │               │  (autonomous)│               │
│  │  │ model 1 │──┼──────────────►│              │               │
│  │  │ model 2 │──┼───► Solver B  │  Self-recovery│              │
│  │  │ model 3 │──┼───► Solver C  │  if stuck    │               │
│  │  └─────────┘  │               └──────┬───────┘               │
│  │  Queue: [...] │                      │                        │
│  └──────────────┘               FlagResultMessage               │
│                                      │                           │
│         ◄────────────────────────────┘                           │
│                                                                  │
│  Coordinator submits flag to platform                            │
└──────────────────────────────────────────────────────────────────┘
```

See [agents.md](agents.md) for the full communication design.

### Compaction and Skill Catalog Protection

```
┌─────────────────────────────────────────┐
│         AgentState.systemPrompt         │  ← NEVER touched by compaction
│  ┌───────────────────────────────────┐  │
│  │  Base persona & instructions      │  │
│  │  <available_skills>               │  │  ← Skill catalog lives here
│  │    <skill>agent-browser</skill>   │  │
│  │  </available_skills>              │  │
│  └───────────────────────────────────┘  │
├─────────────────────────────────────────┤
│        AgentState.messages              │  ← Compaction operates here
│  [user, assistant, toolResult, ...]     │
│                                         │
│  transformContext:                      │
│    if (checkCompact(agent))             │
│      return compact(agent)              │  ← Only modifies messages
└─────────────────────────────────────────┘
```

The skill catalog is protected because it lives in `systemPrompt`, which is passed to the LLM as a separate parameter on every call. `transformContext` (where compaction runs) only receives and returns `AgentMessage[]`.

See [compaction.md](compaction.md) and [skills.md](skills.md) for details.

## Module Structure

```
packages/misuzu-core/src/
├── index.ts                          # Public API exports
├── agents/
│   ├── misuzu-featured.ts            # FeaturedAgent base class
│   ├── misuzu-solver.ts              # Solver agent (self-recovery)
│   └── misuzu-coordinator.ts         # Coordinator agent (model pool, assignment)
├── features/
│   ├── compaction.ts                 # Context compaction (pure functions)
│   ├── skill.ts                      # Skill loading and catalog building
│   └── messages.ts                   # Custom message types & convertToLlm
├── builtins/
│   ├── tools/
│   │   ├── index.ts                  # Tool barrel exports & collections
│   │   ├── base/
│   │   │   ├── bash.ts               # Shell command execution
│   │   │   ├── read.ts               # File reading
│   │   │   ├── write.ts              # File writing
│   │   │   ├── edit.ts               # Surgical text replacement
│   │   │   ├── find.ts               # Glob file search
│   │   │   └── grep.ts               # Content search
│   │   ├── misuzu/
│   │   │   ├── docker.ts             # Docker container management
│   │   │   └── requestrepo.ts        # requestrepo.com OOB testing
│   │   └── utils/
│   │       ├── truncate.ts           # Output truncation (head/tail)
│   │       ├── file-mutation-queue.ts # Serialized file edits
│   │       └── path.ts               # Path resolution utilities
│   └── skills/
│       └── agent-browser/            # Browser automation skill
│           ├── SKILL.md
│           ├── references/
│           └── templates/
```

## Documentation

| Document                           | Content                                                  |
| ---------------------------------- | -------------------------------------------------------- |
| [architecture.md](architecture.md) | This file — system overview                              |
| [tools.md](tools.md)               | Tool system, base tools, CTF tools                       |
| [compaction.md](compaction.md)     | Context compaction, skill catalog protection             |
| [skills.md](skills.md)             | Skill discovery, frontmatter, system prompt integration  |
| [agents.md](agents.md)             | Agent definitions, model pool, assignment, self-recovery |
| [persistence.md](persistence.md)   | Session persistence, competition directory, resume flow  |

## Dependencies

| Package                       | Purpose                                        |
| ----------------------------- | ---------------------------------------------- |
| `@mariozechner/pi-agent-core` | Agent class, AgentTool, events, steer/followUp |
| `@mariozechner/pi-ai`         | LLM providers, Model types, `getModel()`       |
| `@sinclair/typebox`           | JSON Schema for tool parameter validation      |
| `yaml`                        | YAML frontmatter parsing for skills            |
| `glob`                        | File pattern matching for find tool            |
