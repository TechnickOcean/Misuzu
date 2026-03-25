# Persistence

Misuzu persists all agent state to disk so users can close the session and resume later. Each competition gets its own directory with separate session files for the Coordinator and each Solver.

## Table of Contents

- [Overview](#overview)
- [Directory Structure](#directory-structure)
- [Session Format](#session-format)
- [State Files](#state-files)
- [Saving and Loading](#saving-and-loading)
- [Resume Flow](#resume-flow)

## Overview

```
User starts competition
       │
       ▼
Competition directory created on disk
  ├── coordinator/session.jsonl   (append-only message log)
  ├── coordinator/state.json      (challenge queue, assignments)
  ├── solvers/<id>/session.jsonl  (per-solver message log)
  └── solvers/<id>/state.json     (solver status, model)
       │
       │ ... user works, closes terminal ...
       │
       ▼
User resumes competition
       │
       ▼
Load manifest → load state files → rebuild agent messages from session.jsonl → continue
```

## Directory Structure

```
~/.misuzu/competitions/<competition-id>/
├── manifest.json                       # Competition metadata
├── coordinator/
│   ├── session.jsonl                   # Append-only message log
│   └── state.json                      # Challenge queue, solver map
└── solvers/
    ├── <solver-id>/
    │   ├── session.jsonl               # Append-only message log
    │   └── state.json                  # Solver status, model, challenge
    └── <solver-id>/
        ├── session.jsonl
        └── state.json
```

### Competition ID

Generated from platform name + timestamp: `ctftime-2026-03-25`.

### manifest.json

```json
{
  "id": "ctftime-2026-03-25",
  "name": "CTFTime Spring 2026",
  "platformUrl": "https://ctftime.org/event/spring-2026",
  "createdAt": "2026-03-25T10:00:00Z",
  "updatedAt": "2026-03-25T14:30:00Z",
  "modelPool": ["anthropic/claude-sonnet-4-20250514", "openai/gpt-4.1", "google/gemini-2.5-pro"],
  "solverIds": ["challenge-42", "challenge-43", "challenge-45"]
}
```

## Session Format

Each session file is **append-only JSONL** (one JSON object per line). Simple, crash-safe, and easy to resume.

### Entry Types

#### message

Standard agent messages. Covers user, assistant, toolResult, and custom message roles.

```json
{
  "type": "message",
  "id": "a1b2c3d4",
  "parentId": "e5f6a7b8",
  "message": {
    "role": "user",
    "content": "Solve the babyRSA challenge",
    "timestamp": 1742905200000
  }
}
```

#### compaction

Compaction boundary. Messages before this entry were summarized.

```json
{
  "type": "compaction",
  "id": "c1d2e3f4",
  "parentId": "a1b2c3d4",
  "summary": "## Goal\nSolve babyRSA challenge...",
  "firstKeptEntryId": "b2c3d4e5",
  "tokensBefore": 45000,
  "timestamp": "2026-03-25T12:00:00Z"
}
```

#### challenge_state

Solver-specific state transition. Not sent to LLM.

```json
{
  "type": "challenge_state",
  "id": "f4e3d2c1",
  "parentId": "a1b2c3d4",
  "challengeId": "42",
  "status": "solving",
  "model": "anthropic/claude-sonnet-4-20250514",
  "timestamp": "2026-03-25T10:05:00Z"
}
```

### SessionEntry Type

```typescript
export type SessionEntry = MessageEntry | CompactionEntry | ChallengeStateEntry

export interface SessionEntryBase {
  type: string
  id: string // 8-char hex, unique within session
  parentId: string | null
  timestamp: string
}

export interface MessageEntry extends SessionEntryBase {
  type: "message"
  message: AgentMessage
}

export interface CompactionEntry extends SessionEntryBase {
  type: "compaction"
  summary: string
  firstKeptEntryId: string
  tokensBefore: number
}

export interface ChallengeStateEntry extends SessionEntryBase {
  type: "challenge_state"
  challengeId: string
  status: "assigned" | "solving" | "solved" | "failed"
  model?: string
}
```

### Why Append-Only JSONL

| Property         | Benefit                                                   |
| ---------------- | --------------------------------------------------------- |
| Append-only      | Crash-safe: partial writes don't corrupt existing entries |
| JSONL            | Each entry is self-contained, easy to parse line-by-line  |
| No random access | Simpler than SQLite, no schema migrations                 |
| parentId         | Linear chain for misuzu (no branching needed)             |

## State Files

### coordinator/state.json

The Coordinator's working state. Updated on significant transitions (not every message).

```json
{
  "competitionId": "ctftime-2026-03-25",
  "modelPool": [
    {
      "model": "anthropic/claude-sonnet-4-20250514",
      "status": "idle"
    },
    {
      "model": "openai/gpt-4.1",
      "status": "busy",
      "solverId": "challenge-42"
    },
    {
      "model": "google/gemini-2.5-pro",
      "status": "busy",
      "solverId": "challenge-43"
    }
  ],
  "challenges": [
    {
      "id": "42",
      "name": "babyRSA",
      "category": "crypto",
      "difficulty": 2,
      "status": "solving",
      "solverId": "challenge-42",
      "assignedModel": "openai/gpt-4.1"
    },
    {
      "id": "43",
      "name": "heap-master",
      "category": "pwn",
      "difficulty": 4,
      "status": "solving",
      "solverId": "challenge-43",
      "assignedModel": "google/gemini-2.5-pro"
    },
    {
      "id": "45",
      "name": "web-101",
      "category": "web",
      "difficulty": 1,
      "status": "queued"
    }
  ],
  "announcementCheckTime": "2026-03-25T14:00:00Z"
}
```

### solver/state.json

Per-solver working state.

```json
{
  "solverId": "challenge-42",
  "challengeId": "42",
  "model": "openai/gpt-4.1",
  "status": "solving",
  "cwd": "/tmp/ctf-challenge-42",
  "sandboxContainerId": "abc123def456",
  "startedAt": "2026-03-25T10:05:00Z"
}
```

## Saving and Loading

### SessionManager

Manages reading/writing session JSONL files.

```typescript
export class SessionManager {
  private sessionPath: string
  private fd: number

  constructor(sessionPath: string) {
    this.sessionPath = sessionPath
    // Open file for append (create if not exists)
    this.fd = openSync(sessionPath, "a")
  }

  /** Append an entry to the session file */
  append(entry: SessionEntry): void {
    const line = JSON.stringify(entry) + "\n"
    appendFileSync(this.fd, line)
  }

  /** Read all entries from the session file */
  readAll(): SessionEntry[] {
    if (!existsSync(this.sessionPath)) return []
    const content = readFileSync(this.sessionPath, "utf-8")
    return content
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as SessionEntry)
  }

  /** Rebuild AgentMessage[] from session entries */
  buildContext(): AgentMessage[] {
    const entries = this.readAll()
    const messages: AgentMessage[] = []

    for (const entry of entries) {
      if (entry.type === "message") {
        messages.push(entry.message)
      } else if (entry.type === "compaction") {
        messages.push({
          role: "compactionSummary",
          summary: entry.summary,
          tokensBefore: entry.tokensBefore,
          timestamp: new Date(entry.timestamp).getTime(),
        })
      }
      // challenge_state entries are skipped (not LLM context)
    }

    return messages
  }

  close(): void {
    closeSync(this.fd)
  }
}
```

### Save Points

State is saved at these points (not on every message, to reduce I/O):

| Event                | What's saved                                              |
| -------------------- | --------------------------------------------------------- |
| Each message         | Appended to session.jsonl                                 |
| Compaction           | Compaction entry appended to session.jsonl                |
| Solver assigned      | coordinator/state.json updated                            |
| Solver status change | solver/state.json updated                                 |
| Flag found           | Both coordinator/state.json and solver/state.json updated |

## Resume Flow

```typescript
async function resumeCompetition(competitionDir: string): Promise<Competition> {
  // 1. Load manifest
  const manifest = JSON.parse(readFileSync(join(competitionDir, "manifest.json"), "utf-8"))

  // 2. Load coordinator state
  const coordState = JSON.parse(
    readFileSync(join(competitionDir, "coordinator", "state.json"), "utf-8"),
  )

  // 3. Rebuild coordinator agent
  const coordMessages = new SessionManager(
    join(competitionDir, "coordinator", "session.jsonl"),
  ).buildContext()

  const coordinator = new Coordinator({
    model: getModel(coordState.modelPool[0].model),
    ctfPlatformUrl: manifest.platformUrl,
  })
  coordinator.replaceMessages(coordMessages)

  // 4. Rebuild solver agents for active challenges
  const solvers = new Map<string, Solver>()
  for (const challenge of coordState.challenges) {
    if (challenge.status === "solving" && challenge.solverId) {
      const solverDir = join(competitionDir, "solvers", challenge.solverId)
      const solverState = JSON.parse(readFileSync(join(solverDir, "state.json"), "utf-8"))
      const solverMessages = new SessionManager(join(solverDir, "session.jsonl")).buildContext()

      const solver = new Solver({
        cwd: solverState.cwd,
        model: getModel(solverState.model),
        challengeDescription: challenge.name,
      })
      solver.replaceMessages(solverMessages)
      solvers.set(challenge.solverId, solver)
    }
  }

  // 5. Restore model pool state
  const modelPool = new ModelPool(coordState.modelPool)

  return { coordinator, solvers, modelPool, manifest }
}
```

### What Gets Restored

| State                      | How                                |
| -------------------------- | ---------------------------------- |
| Message history            | Replayed from session.jsonl        |
| Compaction summaries       | Read as compactionSummary messages |
| Model assignments          | From coordinator/state.json        |
| Solver working directories | From solver/state.json             |
| Sandbox containers         | NOT restored (must be re-created)  |
| Challenge queue            | From coordinator/state.json        |
| Model pool state           | From coordinator/state.json        |

### What Does NOT Get Restored

- **Sandbox containers**: Docker containers are ephemeral. On resume, solvers re-create their sandbox containers.
- **Network connections**: SSH tunnels, reverse shells, etc. must be re-established.
- **Temporary files**: Files in `/tmp` may be gone. Challenge attachments should be stored in the competition directory.
