import { createHash, randomBytes } from "node:crypto"
import {
  appendFileSync,
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
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

export type JsonObject = Record<string, unknown>

export interface WorkspaceManifest {
  id: string
  name: string
  platformUrl?: string
  createdAt: string
  updatedAt: string
  modelPool: string[]
  solverIds: string[]
}

// Backward-compatible aliases.
export type CompetitionManifest = WorkspaceManifest

export interface WorkspacePersistenceCreateOptions {
  id?: string
  name: string
  platformUrl?: string
  modelPool?: string[]
  createdAt?: string
}

// Backward-compatible alias.
export type CompetitionPersistenceCreateOptions = WorkspacePersistenceCreateOptions

export interface SolverWorkspaceInitOptions {
  solverId: string
  challengeName: string
  category: string
  description: string
  difficulty?: number
  files?: string[]
  model?: string
  launchDir?: string
  remoteUrl?: string
}

export interface SolverWorkspace {
  solverId: string
  rootDir: string
  environmentPath: string
  attachmentsDir: string
  scriptsDir: string
  platformPollScriptPath: string
  writeupPath: string
  statePath: string
  session: SessionManager
}

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

function sanitizeSegment(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

function filenameFromAttachment(input: string, index: number): string {
  if (isHttpUrl(input)) {
    try {
      const url = new URL(input)
      const segment = basename(url.pathname)
      const name = sanitizeSegment(segment)
      if (name.length > 0) {
        return name
      }
    } catch {
      // fall through to default naming
    }
  }

  const localName = sanitizeSegment(basename(input))
  if (localName.length > 0) {
    return localName
  }

  return `attachment-${index + 1}`
}

function renderEnvironmentMarkdown(input: {
  challengeId: string
  challengeName: string
  category: string
  difficulty?: number
  description: string
  remoteUrl?: string
  attachments: string[]
}): string {
  const lines = [
    "# Challenge Environment",
    "",
    "## Challenge",
    `- id: ${input.challengeId}`,
    `- name: ${input.challengeName}`,
    `- category: ${input.category}`,
    `- difficulty: ${input.difficulty ?? "unknown"}`,
    "",
    "## Description",
    input.description,
    "",
    "## Remote Environment",
    `- current url: ${input.remoteUrl ?? "unknown"}`,
    "- expires at: unknown",
    `- last checked at: ${nowIso()}`,
    "",
    "## Attachments",
    ...(input.attachments.length > 0 ? input.attachments.map((path) => `- ${path}`) : ["- (none)"]),
    "",
    "## Hints and Announcements",
    "- (none yet)",
    "",
    "## Operator Notes",
    "- Keep this file up to date. Solver context must follow this file.",
    "",
  ]

  return lines.join("\n")
}

function renderPlatformPollScript(solverId: string): string {
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "",
    `# Poll platform updates for solver ${solverId}.`,
    "# Configure:",
    "#   SOURCE_URL  - endpoint/page to poll",
    "#   INTERVAL    - polling interval in seconds (default: 180)",
    '#   AUTH_HEADER - optional HTTP header, e.g. "Authorization: Bearer ..."',
    "",
    'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
    'ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/../ENVIRONMENT.md}"',
    'QUEUE_FILE="${QUEUE_FILE:-$SCRIPT_DIR/platform-updates.queue.md}"',
    'STATE_FILE="${STATE_FILE:-$SCRIPT_DIR/.platform-poll.sha1}"',
    'SOURCE_URL="${SOURCE_URL:-}"',
    'INTERVAL="${INTERVAL:-180}"',
    'AUTH_HEADER="${AUTH_HEADER:-}"',
    "",
    'if [[ -z "$SOURCE_URL" ]]; then',
    '  echo "SOURCE_URL is not set."',
    `  echo "Example: SOURCE_URL=https://ctf.example.com/challenge/${solverId}/hints ./poll-platform-updates.sh"`,
    "  exit 1",
    "fi",
    "",
    'touch "$QUEUE_FILE"',
    "",
    "while true; do",
    '  if [[ -n "$AUTH_HEADER" ]]; then',
    '    BODY="$(curl -fsSL -H "$AUTH_HEADER" "$SOURCE_URL" || true)"',
    "  else",
    '    BODY="$(curl -fsSL "$SOURCE_URL" || true)"',
    "  fi",
    "",
    '  if [[ -n "$BODY" ]]; then',
    '    HASH="$(printf "%s" "$BODY" | sha1sum | cut -d " " -f 1)"',
    '    LAST_HASH="$(cat "$STATE_FILE" 2>/dev/null || true)"',
    "",
    '    if [[ "$HASH" != "$LAST_HASH" ]]; then',
    '      TS="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"',
    '      printf "- [%s] [platform_poll] %s\\n" "$TS" "$BODY" >> "$QUEUE_FILE"',
    '      printf "%s" "$HASH" > "$STATE_FILE"',
    "",
    "      # Append a lightweight marker in ENVIRONMENT.md for agent visibility.",
    '      printf "- [%s] [platform_poll] New update captured in scripts/platform-updates.queue.md\\n" "$TS" >> "$ENV_FILE"',
    "",
    '      echo "[$TS] New platform update captured"',
    "    fi",
    "  fi",
    "",
    '  sleep "$INTERVAL"',
    "done",
    "",
  ].join("\n")
}

function renderScriptsReadme(): string {
  return `# Solver Scripts

- Put exploit and helper scripts in this directory.
- Optional polling helper: \`poll-platform-updates.sh\`
  - Run it manually or with cron/systemd timer.
  - It writes newly detected notices/hints to \`platform-updates.queue.md\`.
  - After updates are detected, notify coordinator with \`notify_coordinator\` or call \`update_solver_environment\`.
`
}

function replaceOrAppendLine(lines: string[], prefix: string, replacement: string): string[] {
  const index = lines.findIndex((line) => line.startsWith(prefix))
  if (index >= 0) {
    const next = [...lines]
    next[index] = replacement
    return next
  }

  return [...lines, replacement]
}

async function writeAttachment(
  source: string,
  targetPath: string,
  launchDir: string,
): Promise<void> {
  if (isHttpUrl(source)) {
    const response = await fetch(source)
    if (!response.ok) {
      throw new Error(`download failed (${response.status}): ${source}`)
    }
    const body = await response.arrayBuffer()
    writeFileSync(targetPath, Buffer.from(body))
    return
  }

  const absoluteSource = resolve(launchDir, source)
  copyFileSync(absoluteSource, targetPath)
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

export function createWorkspaceId(name: string, date: Date = new Date()): string {
  const slug = sanitizeSegment(name.toLowerCase()) || "workspace"
  const stamp = date.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)
  const suffix = randomBytes(2).toString("hex")
  return `${slug}-${stamp}-${suffix}`
}

export function defaultWorkspacesRoot(launchDir: string = process.cwd()): string {
  return resolve(launchDir, ".misuzu", "workspaces")
}

// Backward-compatible alias.
export const createCompetitionId = createWorkspaceId
// Backward-compatible alias.
export const defaultCompetitionsRoot = defaultWorkspacesRoot

export class CompetitionPersistence {
  readonly workspacesRoot: string
  readonly workspaceDir: string
  readonly coordinatorDir: string
  readonly solversDir: string
  readonly manifestPath: string
  readonly coordinatorSession: SessionManager
  readonly coordinatorEnvironmentPath: string

  private readonly coordinatorStatePath: string
  private readonly solverSessions = new Map<string, SessionManager>()

  private constructor(workspacesRoot: string, workspaceId: string) {
    this.workspacesRoot = resolve(workspacesRoot)
    this.workspaceDir = resolve(this.workspacesRoot, workspaceId)
    this.coordinatorDir = join(this.workspaceDir, "coordinator")
    this.solversDir = join(this.coordinatorDir, "solvers")
    this.manifestPath = join(this.workspaceDir, "manifest.json")
    this.coordinatorStatePath = join(this.coordinatorDir, "state.json")
    this.coordinatorEnvironmentPath = join(this.coordinatorDir, "ENVIRONMENT.md")

    mkdirSync(this.coordinatorDir, { recursive: true })
    mkdirSync(this.solversDir, { recursive: true })
    this.coordinatorSession = new SessionManager(join(this.coordinatorDir, "session.jsonl"))
  }

  static create(
    workspacesRoot: string,
    options: WorkspacePersistenceCreateOptions,
  ): CompetitionPersistence {
    const id = options.id ?? createWorkspaceId(options.name)
    const persistence = new CompetitionPersistence(workspacesRoot, id)
    const createdAt = options.createdAt ?? nowIso()

    const manifest: WorkspaceManifest = {
      id,
      name: options.name,
      platformUrl: options.platformUrl,
      createdAt,
      updatedAt: createdAt,
      modelPool: options.modelPool ?? [],
      solverIds: [],
    }

    persistence.writeManifest(manifest)
    ensureFile(persistence.coordinatorStatePath, "{}\n")
    persistence.initializeCoordinatorEnvironment()
    return persistence
  }

  static open(workspaceDir: string): CompetitionPersistence {
    const resolvedWorkspace = resolve(workspaceDir)
    const workspaceId = basename(resolvedWorkspace)
    const workspacesRoot = dirname(resolvedWorkspace)
    const persistence = new CompetitionPersistence(workspacesRoot, workspaceId)
    if (!existsSync(persistence.manifestPath)) {
      throw new Error(`manifest.json not found in ${resolvedWorkspace}`)
    }
    return persistence
  }

  readManifest(): WorkspaceManifest {
    const raw = readFileSync(this.manifestPath, "utf-8")
    return JSON.parse(raw) as WorkspaceManifest
  }

  updateManifest(patch: Partial<WorkspaceManifest>): WorkspaceManifest {
    const current = this.readManifest()
    const next: WorkspaceManifest = {
      ...current,
      ...patch,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: nowIso(),
      solverIds: patch.solverIds ?? current.solverIds,
      modelPool: patch.modelPool ?? current.modelPool,
    }
    this.writeManifest(next)
    return next
  }

  initializeCoordinatorEnvironment(content?: string): void {
    ensureFile(
      this.coordinatorEnvironmentPath,
      content ?? this.defaultCoordinatorEnvironmentContent(),
    )
  }

  saveCoordinatorState(state: JsonObject): void {
    ensureFile(this.coordinatorStatePath, "{}\n")
    writeFileSync(this.coordinatorStatePath, JSON.stringify(state, null, 2) + "\n", "utf-8")
  }

  loadCoordinatorState<TState extends JsonObject = JsonObject>(): TState | undefined {
    if (!existsSync(this.coordinatorStatePath)) return undefined
    return JSON.parse(readFileSync(this.coordinatorStatePath, "utf-8")) as TState
  }

  getSolverSession(solverId: string): SessionManager {
    const existing = this.solverSessions.get(solverId)
    if (existing) return existing

    const solverDir = join(this.solversDir, solverId)
    mkdirSync(solverDir, { recursive: true })
    const manager = new SessionManager(join(solverDir, "session.jsonl"))
    this.solverSessions.set(solverId, manager)

    const manifest = this.readManifest()
    if (!manifest.solverIds.includes(solverId)) {
      this.updateManifest({ solverIds: [...manifest.solverIds, solverId] })
    }

    return manager
  }

  async ensureSolverWorkspace(options: SolverWorkspaceInitOptions): Promise<SolverWorkspace> {
    const rootDir = join(this.solversDir, options.solverId)
    const attachmentsDir = join(rootDir, "attachments")
    const scriptsDir = join(rootDir, "scripts")
    const environmentPath = join(rootDir, "ENVIRONMENT.md")
    const writeupPath = join(rootDir, "Writeups.md")
    const statePath = join(rootDir, "state.json")

    mkdirSync(attachmentsDir, { recursive: true })
    mkdirSync(scriptsDir, { recursive: true })

    const copiedAttachments = await this.copyAttachments(
      options.solverId,
      options.files ?? [],
      options.launchDir ?? process.cwd(),
    )

    const envContent = renderEnvironmentMarkdown({
      challengeId: options.solverId,
      challengeName: options.challengeName,
      category: options.category,
      difficulty: options.difficulty,
      description: options.description,
      remoteUrl: options.remoteUrl,
      attachments: copiedAttachments.map((name) => `attachments/${name}`),
    })

    writeFileSync(environmentPath, envContent, "utf-8")
    if (!existsSync(writeupPath)) {
      writeFileSync(
        writeupPath,
        `# Writeup: ${options.challengeName}\n\nStatus: pending\n\n`,
        "utf-8",
      )
    }

    const platformPollScriptPath = join(scriptsDir, "poll-platform-updates.sh")
    if (!existsSync(platformPollScriptPath)) {
      writeFileSync(platformPollScriptPath, renderPlatformPollScript(options.solverId), {
        encoding: "utf-8",
      })
    }

    const scriptsReadmePath = join(scriptsDir, "README.md")
    if (!existsSync(scriptsReadmePath)) {
      writeFileSync(scriptsReadmePath, renderScriptsReadme(), "utf-8")
    }

    this.saveSolverState(options.solverId, {
      solverId: options.solverId,
      challengeName: options.challengeName,
      category: options.category,
      status: "assigned",
      model: options.model,
      cwd: rootDir,
      environmentPath,
      platformPollScriptPath,
      updatedAt: nowIso(),
    })

    return {
      solverId: options.solverId,
      rootDir,
      environmentPath,
      attachmentsDir,
      scriptsDir,
      platformPollScriptPath,
      writeupPath,
      statePath,
      session: this.getSolverSession(options.solverId),
    }
  }

  saveSolverState(solverId: string, state: JsonObject): void {
    const solverDir = join(this.solversDir, solverId)
    mkdirSync(solverDir, { recursive: true })
    const statePath = join(solverDir, "state.json")
    writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n", "utf-8")
    this.getSolverSession(solverId)
  }

  loadSolverState<TState extends JsonObject = JsonObject>(solverId: string): TState | undefined {
    const statePath = join(this.solversDir, solverId, "state.json")
    if (!existsSync(statePath)) return undefined
    return JSON.parse(readFileSync(statePath, "utf-8")) as TState
  }

  readSolverEnvironment(solverId: string): string {
    const path = this.getSolverEnvironmentPath(solverId)
    ensureFile(path, "# Challenge Environment\n")
    return readFileSync(path, "utf-8")
  }

  writeSolverEnvironment(solverId: string, content: string): void {
    const path = this.getSolverEnvironmentPath(solverId)
    ensureFile(path, "# Challenge Environment\n")
    writeFileSync(path, content, "utf-8")
  }

  appendSolverEnvironmentNote(solverId: string, note: string): void {
    const path = this.getSolverEnvironmentPath(solverId)
    ensureFile(path, "# Challenge Environment\n")
    appendFileSync(path, `- [${nowIso()}] ${note}\n`, "utf-8")
  }

  updateSolverEnvironmentUrl(solverId: string, url: string, expiresAt?: string): void {
    const path = this.getSolverEnvironmentPath(solverId)
    ensureFile(path, "# Challenge Environment\n")

    const current = readFileSync(path, "utf-8")
    const lines = current.split("\n")
    let next = replaceOrAppendLine(lines, "- current url:", `- current url: ${url}`)
    next = replaceOrAppendLine(next, "- expires at:", `- expires at: ${expiresAt ?? "unknown"}`)
    next = replaceOrAppendLine(next, "- last checked at:", `- last checked at: ${nowIso()}`)
    writeFileSync(path, next.join("\n"), "utf-8")
  }

  appendSolverWriteup(solverId: string, markdown: string): void {
    const path = this.getSolverWriteupPath(solverId)
    ensureFile(path, "")
    const prefix = markdown.startsWith("\n") ? "" : "\n"
    appendFileSync(path, `${prefix}${markdown}\n`, "utf-8")
  }

  getSolverEnvironmentPath(solverId: string): string {
    return join(this.solversDir, solverId, "ENVIRONMENT.md")
  }

  getSolverWriteupPath(solverId: string): string {
    return join(this.solversDir, solverId, "Writeups.md")
  }

  close(): void {
    this.coordinatorSession.close()
    for (const session of this.solverSessions.values()) {
      session.close()
    }
    this.solverSessions.clear()
  }

  private defaultCoordinatorEnvironmentContent(): string {
    return [
      "# Coordinator Environment",
      "",
      "## Platform",
      "- url: unknown",
      "- last checked at: " + nowIso(),
      "",
      "## Announcements",
      "- (none yet)",
      "",
    ].join("\n")
  }

  private writeManifest(manifest: WorkspaceManifest): void {
    ensureFile(this.manifestPath, "{}\n")
    writeFileSync(this.manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8")
  }

  private async copyAttachments(
    solverId: string,
    files: string[],
    launchDir: string,
  ): Promise<string[]> {
    const attachmentsDir = join(this.solversDir, solverId, "attachments")
    mkdirSync(attachmentsDir, { recursive: true })

    const copied: string[] = []
    for (let i = 0; i < files.length; i++) {
      const source = files[i]
      const filename = filenameFromAttachment(source, i)
      const targetPath = join(attachmentsDir, filename)

      try {
        await writeAttachment(source, targetPath, launchDir)
        copied.push(filename)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        appendFileSync(
          join(attachmentsDir, "_download-errors.log"),
          `[${nowIso()}] ${source} -> ${filename}: ${message}\n`,
          "utf-8",
        )
      }
    }

    return copied
  }
}
