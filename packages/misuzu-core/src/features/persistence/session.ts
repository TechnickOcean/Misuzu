import { createHash, randomBytes } from "node:crypto"
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { dirname, resolve } from "node:path"
import type { AgentEvent, AgentMessage } from "@mariozechner/pi-agent-core"

export interface SessionEntryBase {
  type: string
  id: string
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
  tokensBefore: number
  firstKeptEntryId?: string
}

export interface ChallengeStateEntry extends SessionEntryBase {
  type: "challenge_state"
  challengeId: string
  status: "assigned" | "solving" | "solved" | "failed"
  model?: string
}

export type SessionEntry = MessageEntry | CompactionEntry | ChallengeStateEntry

interface SessionEntryInputBase {
  id?: string
  parentId?: string | null
  timestamp?: string
}

function nowIso(): string {
  return new Date().toISOString()
}

function newEntryId(): string {
  return randomBytes(4).toString("hex")
}

function messageFingerprint(message: AgentMessage): string {
  return createHash("sha1").update(JSON.stringify(message)).digest("hex")
}

function compactionFingerprint(summary: string, tokensBefore: number, timestampMs: number): string {
  return createHash("sha1")
    .update(
      JSON.stringify({ role: "compactionSummary", summary, tokensBefore, timestamp: timestampMs }),
    )
    .digest("hex")
}

function ensureParentDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true })
}

function ensureFile(filePath: string, initialContent = ""): void {
  ensureParentDir(filePath)
  if (!existsSync(filePath)) {
    writeFileSync(filePath, initialContent, "utf-8")
  }
}

export class SessionManager {
  readonly sessionPath: string
  private fd: number
  private lastEntryId: string | null

  constructor(sessionPath: string) {
    this.sessionPath = resolve(sessionPath)
    ensureFile(this.sessionPath)
    this.fd = openSync(this.sessionPath, "a")
    const entries = this.readAll()
    this.lastEntryId = entries.length > 0 ? entries[entries.length - 1].id : null
  }

  appendMessage(message: AgentMessage, input: SessionEntryInputBase = {}): MessageEntry {
    return this.appendEntry({
      type: "message",
      message,
      ...input,
    }) as MessageEntry
  }

  appendCompaction(
    summary: string,
    tokensBefore: number,
    firstKeptEntryId?: string,
    input: SessionEntryInputBase = {},
  ): CompactionEntry {
    return this.appendEntry({
      type: "compaction",
      summary,
      tokensBefore,
      firstKeptEntryId,
      ...input,
    }) as CompactionEntry
  }

  appendChallengeState(
    challengeId: string,
    status: ChallengeStateEntry["status"],
    model?: string,
    input: SessionEntryInputBase = {},
  ): ChallengeStateEntry {
    return this.appendEntry({
      type: "challenge_state",
      challengeId,
      status,
      model,
      ...input,
    }) as ChallengeStateEntry
  }

  readAll(): SessionEntry[] {
    if (!existsSync(this.sessionPath)) return []

    const content = readFileSync(this.sessionPath, "utf-8")
    if (!content.trim()) return []

    return content
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as SessionEntry)
  }

  buildContext(): AgentMessage[] {
    const entries = this.readAll()
    const messages: AgentMessage[] = []

    for (const entry of entries) {
      if (entry.type === "message") {
        messages.push(entry.message)
        continue
      }

      if (entry.type === "compaction") {
        messages.push({
          role: "compactionSummary",
          summary: entry.summary,
          tokensBefore: entry.tokensBefore,
          timestamp: new Date(entry.timestamp).getTime(),
        } as AgentMessage)
      }
    }

    return messages
  }

  close(): void {
    closeSync(this.fd)
  }

  private appendEntry(
    partial:
      | ({ type: "message"; message: AgentMessage } & SessionEntryInputBase)
      | ({
          type: "compaction"
          summary: string
          tokensBefore: number
          firstKeptEntryId?: string
        } & SessionEntryInputBase)
      | ({
          type: "challenge_state"
          challengeId: string
          status: ChallengeStateEntry["status"]
          model?: string
        } & SessionEntryInputBase),
  ): SessionEntry {
    const entry: SessionEntry = {
      ...partial,
      id: partial.id ?? newEntryId(),
      parentId: partial.parentId ?? this.lastEntryId,
      timestamp: partial.timestamp ?? nowIso(),
    } as SessionEntry

    appendFileSync(this.fd, JSON.stringify(entry) + "\n", "utf-8")
    this.lastEntryId = entry.id
    return entry
  }
}

export interface PersistableAgent {
  state: { messages: AgentMessage[] }
  subscribe(fn: (event: AgentEvent) => void): () => void
}

export class AgentSessionRecorder {
  private readonly seenMessageFingerprints = new Set<string>()
  private unsubscribe?: () => void

  constructor(private readonly session: SessionManager) {
    for (const entry of this.session.readAll()) {
      if (entry.type === "message") {
        this.seenMessageFingerprints.add(messageFingerprint(entry.message))
        continue
      }

      if (entry.type === "compaction") {
        this.seenMessageFingerprints.add(
          compactionFingerprint(
            entry.summary,
            entry.tokensBefore,
            new Date(entry.timestamp).getTime(),
          ),
        )
      }
    }
  }

  attach(agent: PersistableAgent): () => void {
    this.flush(agent.state.messages)
    this.unsubscribe = agent.subscribe((event) => {
      if (event.type === "message_end" || event.type === "turn_end" || event.type === "agent_end") {
        this.flush(agent.state.messages)
      }
    })

    return () => {
      if (this.unsubscribe) {
        this.unsubscribe()
        this.unsubscribe = undefined
      }
    }
  }

  flush(messages: AgentMessage[]): number {
    let persisted = 0

    for (const message of messages) {
      if (message.role === "compactionSummary") {
        const key = compactionFingerprint(message.summary, message.tokensBefore, message.timestamp)
        if (this.seenMessageFingerprints.has(key)) continue

        this.session.appendCompaction(message.summary, message.tokensBefore, undefined, {
          timestamp: new Date(message.timestamp).toISOString(),
        })
        this.seenMessageFingerprints.add(key)
        persisted += 1
        continue
      }

      const key = messageFingerprint(message)
      if (this.seenMessageFingerprints.has(key)) continue

      this.session.appendMessage(message)
      this.seenMessageFingerprints.add(key)
      persisted += 1
    }

    return persisted
  }
}
