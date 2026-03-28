import { createReadStream, promises as fs } from "node:fs"
import path from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"
import type { IncomingMessage, ServerResponse } from "node:http"
import { defineConfig, type Plugin } from "vite-plus"

type CountMap = Record<string, number>

interface SessionStats {
  filePath: string
  exists: boolean
  lineCount: number
  messageCount: number
  parseErrorCount: number
  entryTypeCounts: CountMap
  roleCounts: CountMap
  toolCalls: CountMap
  toolResults: CountMap
  stopReasons: CountMap
  modelTokens: CountMap
  inputTokens: number
  outputTokens: number
  totalTokens: number
  totalCost: number
  firstTimestamp?: string
  lastTimestamp?: string
  timeline: CountMap
}

interface WorkspaceListItem {
  id: string
  name: string
  path: string
  createdAt?: string
  updatedAt?: string
  solverCount: number
}

interface SolverSummary {
  solverId: string
  challengeName?: string
  category?: string
  status: string
  model?: string
  updatedAt?: string
  lastAgentEndReason?: string
  lastAgentEndAt?: string
  latestSubmittedFlag?: string
  lastRejectedFlag?: string
  details?: string
  cwd?: string
  writeupLines: number
  scriptFileCount: number
  attachmentFileCount: number
  session: SessionStats
}

interface WorkspaceSummary {
  generatedAt: string
  workspace: {
    id: string
    name: string
    path: string
    createdAt?: string
    updatedAt?: string
  }
  coordinator: {
    stateUpdatedAt?: string
    queueSize: number
    modelSlots: {
      total: number
      busy: number
      idle: number
      byModel: Array<{ model: string; total: number; busy: number; idle: number }>
    }
    challengeQueue: Array<{
      challengeId?: string
      challengeName?: string
      category?: string
      difficulty?: number
      description?: string
    }>
    session: SessionStats
  }
  solvers: SolverSummary[]
  aggregates: {
    solverCount: number
    queueSize: number
    submittedFlagCount: number
    rejectedFlagCount: number
    totalMessages: number
    totalToolCalls: number
    totalTokens: number
    totalCost: number
    statusCounts: CountMap
    categoryCounts: CountMap
    modelCounts: CountMap
    topTools: Array<{ name: string; count: number }>
    timeline: Array<{ bucket: string; count: number }>
  }
}

interface WorkspaceFileEntry {
  relativePath: string
  name: string
  parentPath: string
  kind: "file" | "directory" | "symlink"
  size: number
  updatedAt: string
  extension: string
  depth: number
  tags: string[]
}

interface SessionLinePreview {
  lineNumber: number
  timestamp?: string
  entryType: string
  role?: string
  toolName?: string
  model?: string
  stopReason?: string
  preview: string
  parseError?: string
  rawLine?: string
  contentTypes?: string[]
  toolCalls?: string[]
  textSnippets?: string[]
  usage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
}

const textFileExtensions = new Set([
  ".txt",
  ".md",
  ".json",
  ".jsonl",
  ".yml",
  ".yaml",
  ".xml",
  ".html",
  ".css",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".mts",
  ".cts",
  ".tsx",
  ".jsx",
  ".py",
  ".sh",
  ".bash",
  ".zsh",
  ".toml",
  ".ini",
  ".cfg",
  ".conf",
  ".dockerfile",
  ".log",
  ".csv",
  ".sql",
  ".java",
  ".go",
  ".rs",
  ".c",
  ".cc",
  ".cpp",
  ".h",
  ".hpp",
])

const textWindowDefaultLimit = 220
const textWindowMaxLimit = 1200
const sessionWindowDefaultLimit = 160
const sessionWindowMaxLimit = 400
const binaryPreviewBytes = 4096

const appDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(appDir, "..", "..")
const workspacesRoot = path.resolve(repoRoot, ".misuzu", "workspaces")
const preferredWorkspaceId = "misuzu-coordinator-20260328-034553-8281"

function addCount(map: CountMap, key: string, amount = 1): void {
  if (!key) return
  map[key] = (map[key] ?? 0) + amount
}

function toSortedEntries(map: CountMap): Array<{ name: string; count: number }> {
  return Object.entries(map)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

function mergeCountMaps(...maps: CountMap[]): CountMap {
  const merged: CountMap = {}
  for (const map of maps) {
    for (const [key, value] of Object.entries(map)) {
      addCount(merged, key, value)
    }
  }
  return merged
}

function emptySessionStats(filePath: string): SessionStats {
  return {
    filePath,
    exists: false,
    lineCount: 0,
    messageCount: 0,
    parseErrorCount: 0,
    entryTypeCounts: {},
    roleCounts: {},
    toolCalls: {},
    toolResults: {},
    stopReasons: {},
    modelTokens: {},
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    totalCost: 0,
    timeline: {},
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  if (!(await pathExists(filePath))) {
    return undefined
  }

  try {
    const raw = await fs.readFile(filePath, "utf8")
    return JSON.parse(raw) as T
  } catch {
    return undefined
  }
}

function normalizeTimestamp(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString()
  }

  if (typeof value === "string") {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString()
  }

  return undefined
}

function toTimelineBucket(isoTimestamp: string): string {
  const parsed = new Date(isoTimestamp)
  const minute = Math.floor(parsed.getUTCMinutes() / 5) * 5
  parsed.setUTCMinutes(minute, 0, 0)
  return parsed.toISOString()
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

async function readSessionStats(filePath: string): Promise<SessionStats> {
  const stats = emptySessionStats(filePath)
  if (!(await pathExists(filePath))) {
    return stats
  }

  stats.exists = true

  const stream = createReadStream(filePath, { encoding: "utf8" })
  const reader = createInterface({ input: stream, crlfDelay: Infinity })

  for await (const rawLine of reader) {
    const line = rawLine.trim()
    if (line.length === 0) continue

    stats.lineCount += 1

    let entry: Record<string, unknown>
    try {
      entry = JSON.parse(line) as Record<string, unknown>
    } catch {
      stats.parseErrorCount += 1
      continue
    }

    const entryType = typeof entry.type === "string" ? entry.type : "unknown"
    addCount(stats.entryTypeCounts, entryType)

    const timestamp = normalizeTimestamp(entry.timestamp)
    if (timestamp) {
      if (!stats.firstTimestamp || timestamp < stats.firstTimestamp) {
        stats.firstTimestamp = timestamp
      }
      if (!stats.lastTimestamp || timestamp > stats.lastTimestamp) {
        stats.lastTimestamp = timestamp
      }
      addCount(stats.timeline, toTimelineBucket(timestamp))
    }

    if (entryType !== "message") continue

    const message =
      typeof entry.message === "object" && entry.message !== null
        ? (entry.message as Record<string, unknown>)
        : undefined
    if (!message) continue

    stats.messageCount += 1

    const role = typeof message.role === "string" ? message.role : "unknown"
    addCount(stats.roleCounts, role)

    if (role === "assistant") {
      const usage =
        typeof message.usage === "object" && message.usage !== null
          ? (message.usage as Record<string, unknown>)
          : undefined

      const inputTokens = asNumber(usage?.input)
      const outputTokens = asNumber(usage?.output)
      const totalTokens = asNumber(usage?.totalTokens)
      stats.inputTokens += inputTokens
      stats.outputTokens += outputTokens
      stats.totalTokens += totalTokens || inputTokens + outputTokens

      const usageCost =
        usage && typeof usage.cost === "object" && usage.cost !== null
          ? (usage.cost as Record<string, unknown>)
          : undefined
      stats.totalCost += asNumber(usageCost?.total)

      const model = typeof message.model === "string" ? message.model : undefined
      if (model) {
        addCount(stats.modelTokens, model, totalTokens || inputTokens + outputTokens)
      }

      const stopReason = typeof message.stopReason === "string" ? message.stopReason : undefined
      if (stopReason) {
        addCount(stats.stopReasons, stopReason)
      }

      const content = Array.isArray(message.content) ? message.content : []
      for (const part of content) {
        if (typeof part !== "object" || part === null) continue
        const chunk = part as Record<string, unknown>
        if (chunk.type !== "toolCall") continue
        const toolName = typeof chunk.name === "string" ? chunk.name : "unknown"
        addCount(stats.toolCalls, toolName)
      }
    }

    if (role === "toolResult") {
      const toolName = typeof message.toolName === "string" ? message.toolName : "unknown"
      addCount(stats.toolResults, toolName)
    }
  }

  return stats
}

async function countFilesRecursive(targetPath: string, depth = 5): Promise<number> {
  if (depth < 0 || !(await pathExists(targetPath))) {
    return 0
  }

  let total = 0
  const entries = await fs.readdir(targetPath, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(targetPath, entry.name)
    if (entry.isFile()) {
      total += 1
      continue
    }
    if (entry.isDirectory()) {
      total += await countFilesRecursive(fullPath, depth - 1)
    }
  }

  return total
}

async function countWriteupLines(filePath: string): Promise<number> {
  if (!(await pathExists(filePath))) return 0

  try {
    const raw = await fs.readFile(filePath, "utf8")
    return raw
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0).length
  } catch {
    return 0
  }
}

function summarizeModelSlots(
  statePool: unknown,
  manifestPool: unknown,
): {
  total: number
  busy: number
  idle: number
  byModel: Array<{ model: string; total: number; busy: number; idle: number }>
} {
  const byModel = new Map<string, { model: string; total: number; busy: number; idle: number }>()
  let busy = 0
  let idle = 0

  const slots = Array.isArray(statePool) ? statePool : []
  if (slots.length > 0) {
    for (const slot of slots) {
      if (typeof slot !== "object" || slot === null) continue
      const value = slot as Record<string, unknown>
      const model = typeof value.model === "string" ? value.model : "unknown"
      const status = typeof value.status === "string" ? value.status : "unknown"
      const bucket = byModel.get(model) ?? { model, total: 0, busy: 0, idle: 0 }

      bucket.total += 1
      if (status === "busy") {
        bucket.busy += 1
        busy += 1
      } else {
        bucket.idle += 1
        idle += 1
      }

      byModel.set(model, bucket)
    }
  } else {
    const fallback = Array.isArray(manifestPool) ? manifestPool : []
    for (const item of fallback) {
      if (typeof item !== "string") continue
      const bucket = byModel.get(item) ?? { model: item, total: 0, busy: 0, idle: 0 }
      bucket.total += 1
      bucket.idle += 1
      idle += 1
      byModel.set(item, bucket)
    }
  }

  const byModelList = Array.from(byModel.values()).sort((a, b) => b.total - a.total)
  return {
    total: busy + idle,
    busy,
    idle,
    byModel: byModelList,
  }
}

function normalizeSolverStatus(raw: unknown): string {
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw
  }
  return "unknown"
}

async function getWorkspaceList(): Promise<WorkspaceListItem[]> {
  if (!(await pathExists(workspacesRoot))) {
    return []
  }

  const dirEntries = await fs.readdir(workspacesRoot, { withFileTypes: true })
  const list: WorkspaceListItem[] = []

  for (const entry of dirEntries) {
    if (!entry.isDirectory()) continue
    const workspacePath = path.join(workspacesRoot, entry.name)
    const manifestPath = path.join(workspacePath, "manifest.json")
    if (!(await pathExists(manifestPath))) continue

    const manifest = await readJsonFile<Record<string, unknown>>(manifestPath)
    const solverIds = Array.isArray(manifest?.solverIds) ? manifest.solverIds : []

    list.push({
      id: typeof manifest?.id === "string" ? manifest.id : entry.name,
      name: typeof manifest?.name === "string" ? manifest.name : entry.name,
      path: workspacePath,
      createdAt: typeof manifest?.createdAt === "string" ? manifest.createdAt : undefined,
      updatedAt: typeof manifest?.updatedAt === "string" ? manifest.updatedAt : undefined,
      solverCount: solverIds.length,
    })
  }

  return list.sort((a, b) => {
    const left = a.updatedAt ?? a.createdAt ?? ""
    const right = b.updatedAt ?? b.createdAt ?? ""
    return right.localeCompare(left)
  })
}

function resolveWorkspaceCandidate(
  requestedPath: string | null,
  workspaces: WorkspaceListItem[],
): string {
  if (requestedPath && requestedPath.trim().length > 0) {
    const candidate = path.resolve(requestedPath.trim())
    const normalizedRoot = workspacesRoot.toLowerCase()
    if (!candidate.toLowerCase().startsWith(normalizedRoot)) {
      throw new Error("Workspace path must be inside .misuzu/workspaces")
    }
    return candidate
  }

  const preferredPath = path.join(workspacesRoot, preferredWorkspaceId)
  if (workspaces.some((item) => path.resolve(item.path) === path.resolve(preferredPath))) {
    return preferredPath
  }

  return workspaces[0]?.path ?? preferredPath
}

function normalizeRelativePath(value: string): string {
  if (!value) return ""
  return value.replaceAll("\\", "/").replace(/^\.\//u, "")
}

function toComparablePath(value: string): string {
  const resolved = path.resolve(value)
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

function isPathInside(parentPath: string, candidatePath: string): boolean {
  const normalizedParent = toComparablePath(parentPath)
  const normalizedCandidate = toComparablePath(candidatePath)

  if (normalizedCandidate === normalizedParent) {
    return true
  }

  const prefix = normalizedParent.endsWith(path.sep)
    ? normalizedParent
    : `${normalizedParent}${path.sep}`
  return normalizedCandidate.startsWith(prefix)
}

function parseWindowNumber(
  value: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  return Math.max(min, Math.min(max, parsed))
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}...`
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return "[unserializable]"
  }
}

function classifyEntryTags(relativePath: string, kind: WorkspaceFileEntry["kind"]): string[] {
  const normalized = relativePath.toLowerCase()
  const tags = new Set<string>()

  if (normalized.endsWith("session.jsonl")) tags.add("session")
  if (normalized.endsWith("writeups.md")) tags.add("writeup")
  if (normalized.includes("/scripts/")) tags.add("script")
  if (normalized.includes("/attachments/")) tags.add("attachment")
  if (normalized.endsWith("environment.md")) tags.add("environment")
  if (normalized.endsWith("state.json")) tags.add("state")
  if (normalized.endsWith("manifest.json")) tags.add("manifest")
  if (normalized.endsWith(".jsonl")) tags.add("jsonl")
  if (normalized.endsWith(".md")) tags.add("markdown")

  if (kind === "directory") {
    if (normalized.endsWith("/solvers")) tags.add("solvers-root")
    if (normalized.includes("/solvers/")) tags.add("solver-dir")
    if (normalized.endsWith("/scripts")) tags.add("scripts-dir")
    if (normalized.endsWith("/attachments")) tags.add("attachments-dir")
  }

  return Array.from(tags)
}

async function buildWorkspaceFileIndex(workspacePath: string): Promise<{
  entries: WorkspaceFileEntry[]
  totalFiles: number
  totalDirectories: number
  totalSymlinks: number
  totalBytes: number
  extensionCounts: CountMap
  tagCounts: CountMap
  largestFiles: Array<{ relativePath: string; size: number }>
}> {
  const entries: WorkspaceFileEntry[] = []
  const extensionCounts: CountMap = {}
  const tagCounts: CountMap = {}
  let totalFiles = 0
  let totalDirectories = 0
  let totalSymlinks = 0
  let totalBytes = 0

  const stack = [workspacePath]
  while (stack.length > 0) {
    const currentDir = stack.pop()
    if (!currentDir) continue

    const dirEntries = await fs.readdir(currentDir, { withFileTypes: true })
    dirEntries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) {
        return a.isDirectory() ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })

    for (const entry of dirEntries) {
      const fullPath = path.join(currentDir, entry.name)
      const relativePath = normalizeRelativePath(path.relative(workspacePath, fullPath))
      if (!relativePath) continue

      const parentPath = normalizeRelativePath(path.dirname(relativePath))
      const depth = relativePath.split("/").length - 1
      const stats = await fs.lstat(fullPath)
      const extension = path.extname(entry.name).toLowerCase() || "(none)"

      let kind: WorkspaceFileEntry["kind"] = "file"
      if (entry.isDirectory()) {
        kind = "directory"
      } else if (entry.isSymbolicLink()) {
        kind = "symlink"
      }

      const tags = classifyEntryTags(relativePath, kind)
      for (const tag of tags) {
        addCount(tagCounts, tag)
      }

      entries.push({
        relativePath,
        name: entry.name,
        parentPath: parentPath === "." ? "" : parentPath,
        kind,
        size: stats.size,
        updatedAt: stats.mtime.toISOString(),
        extension,
        depth,
        tags,
      })

      if (kind === "directory") {
        totalDirectories += 1
        stack.push(fullPath)
      } else if (kind === "symlink") {
        totalSymlinks += 1
      } else {
        totalFiles += 1
        totalBytes += stats.size
        addCount(extensionCounts, extension)
      }
    }
  }

  const largestFiles = entries
    .filter((entry) => entry.kind === "file")
    .sort((a, b) => b.size - a.size)
    .slice(0, 20)
    .map((entry) => ({
      relativePath: entry.relativePath,
      size: entry.size,
    }))

  entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath))

  return {
    entries,
    totalFiles,
    totalDirectories,
    totalSymlinks,
    totalBytes,
    extensionCounts,
    tagCounts,
    largestFiles,
  }
}

async function readFilePrefix(filePath: string, maxBytes: number): Promise<Buffer> {
  const handle = await fs.open(filePath, "r")
  try {
    const buffer = Buffer.allocUnsafe(maxBytes)
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

function isLikelyBinary(prefix: Buffer): boolean {
  if (prefix.length === 0) return false
  let suspiciousCount = 0

  for (const byte of prefix) {
    if (byte === 0) return true
    if ((byte <= 8 || (byte >= 14 && byte <= 31)) && byte !== 9 && byte !== 10 && byte !== 13) {
      suspiciousCount += 1
    }
  }

  return suspiciousCount / prefix.length > 0.2
}

function toHexPreview(prefix: Buffer): string {
  const lines: string[] = []
  for (let offset = 0; offset < prefix.length; offset += 16) {
    const chunk = prefix.subarray(offset, offset + 16)
    const hex = Array.from(chunk)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(" ")
      .padEnd(47, " ")
    const ascii = Array.from(chunk)
      .map((byte) => {
        if (byte >= 32 && byte <= 126) return String.fromCharCode(byte)
        return "."
      })
      .join("")
    lines.push(`${offset.toString(16).padStart(8, "0")}  ${hex}  ${ascii}`)
  }
  return lines.join("\n")
}

async function readTextWindow(
  filePath: string,
  offset: number,
  limit: number,
): Promise<{ totalLines: number; lines: string[]; hasMore: boolean }> {
  const stream = createReadStream(filePath, { encoding: "utf8" })
  const reader = createInterface({ input: stream, crlfDelay: Infinity })
  let totalLines = 0
  const lines: string[] = []

  for await (const line of reader) {
    totalLines += 1
    if (totalLines <= offset) continue
    if (lines.length < limit) {
      lines.push(line)
    }
  }

  return {
    totalLines,
    lines,
    hasMore: offset + lines.length < totalLines,
  }
}

function extractMessagePreview(message: Record<string, unknown>): string {
  const role = typeof message.role === "string" ? message.role : "message"
  const content = Array.isArray(message.content) ? message.content : []

  for (const part of content) {
    if (typeof part !== "object" || part === null) continue
    const value = part as Record<string, unknown>
    const type = typeof value.type === "string" ? value.type : "unknown"

    if (type === "text" && typeof value.text === "string") {
      return `${role}: ${truncate(value.text.replaceAll("\n", " "), 180)}`
    }

    if (type === "toolCall") {
      const name = typeof value.name === "string" ? value.name : "tool"
      return `${role}: toolCall ${name}`
    }

    if (type === "toolResult") {
      const name = typeof value.toolName === "string" ? value.toolName : "tool"
      return `${role}: toolResult ${name}`
    }
  }

  if (content.length > 0) {
    return `${role}: ${truncate(safeJson(content[0]), 180)}`
  }

  return `${role}: ${truncate(safeJson(message), 180)}`
}

async function readSessionWindow(
  filePath: string,
  offset: number,
  limit: number,
): Promise<{
  totalLines: number
  records: SessionLinePreview[]
  parseErrorCount: number
  entryTypeCounts: CountMap
  roleCounts: CountMap
  toolCounts: CountMap
  modelCounts: CountMap
}> {
  const stream = createReadStream(filePath, { encoding: "utf8" })
  const reader = createInterface({ input: stream, crlfDelay: Infinity })

  let totalLines = 0
  let parseErrorCount = 0
  const records: SessionLinePreview[] = []
  const entryTypeCounts: CountMap = {}
  const roleCounts: CountMap = {}
  const toolCounts: CountMap = {}
  const modelCounts: CountMap = {}

  for await (const rawLine of reader) {
    const line = rawLine.trim()
    if (line.length === 0) continue

    totalLines += 1
    const inWindow = totalLines > offset && records.length < limit

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(line) as Record<string, unknown>
    } catch {
      parseErrorCount += 1
      if (inWindow) {
        records.push({
          lineNumber: totalLines,
          entryType: "parse_error",
          preview: truncate(line, 180),
          parseError: "Invalid JSON",
          rawLine: truncate(line, 4000),
        })
      }
      continue
    }

    const entryType = typeof parsed.type === "string" ? parsed.type : "unknown"
    addCount(entryTypeCounts, entryType)

    const timestamp = normalizeTimestamp(parsed.timestamp)
    const message =
      typeof parsed.message === "object" && parsed.message !== null
        ? (parsed.message as Record<string, unknown>)
        : undefined

    const role = typeof message?.role === "string" ? message.role : undefined
    if (role) {
      addCount(roleCounts, role)
    }

    const model = typeof message?.model === "string" ? message.model : undefined
    if (model) {
      addCount(modelCounts, model)
    }

    let toolName: string | undefined
    const contentTypes: string[] = []
    const toolCalls: string[] = []
    const textSnippets: string[] = []
    let usage:
      | {
          inputTokens: number
          outputTokens: number
          totalTokens: number
        }
      | undefined

    if (role === "toolResult" && typeof message?.toolName === "string") {
      toolName = message.toolName
      addCount(toolCounts, toolName)
    }

    if (role === "assistant") {
      const usageValue =
        typeof message?.usage === "object" && message.usage !== null
          ? (message.usage as Record<string, unknown>)
          : undefined
      usage = {
        inputTokens: asNumber(usageValue?.input),
        outputTokens: asNumber(usageValue?.output),
        totalTokens: asNumber(usageValue?.totalTokens),
      }

      const content = Array.isArray(message?.content) ? message.content : []
      for (const part of content) {
        if (typeof part !== "object" || part === null) continue
        const chunk = part as Record<string, unknown>
        const partType = typeof chunk.type === "string" ? chunk.type : "unknown"
        contentTypes.push(partType)

        if (partType === "toolCall") {
          const name = typeof chunk.name === "string" ? chunk.name : "unknown"
          addCount(toolCounts, name)
          toolName = toolName ?? name
          toolCalls.push(name)
          continue
        }

        if (partType === "text" && typeof chunk.text === "string") {
          textSnippets.push(truncate(chunk.text.replaceAll("\n", " "), 220))
        }
      }
    }

    if (message && role !== "assistant") {
      const content = Array.isArray(message.content) ? message.content : []
      for (const part of content) {
        if (typeof part !== "object" || part === null) continue
        const chunk = part as Record<string, unknown>
        const partType = typeof chunk.type === "string" ? chunk.type : "unknown"
        contentTypes.push(partType)

        if (partType === "text" && typeof chunk.text === "string") {
          textSnippets.push(truncate(chunk.text.replaceAll("\n", " "), 220))
        }
      }
    }

    const stopReason = typeof message?.stopReason === "string" ? message.stopReason : undefined
    const preview = message ? extractMessagePreview(message) : truncate(safeJson(parsed), 180)

    if (inWindow) {
      records.push({
        lineNumber: totalLines,
        timestamp,
        entryType,
        role,
        toolName,
        model,
        stopReason,
        preview,
        rawLine: truncate(line, 4000),
        contentTypes: Array.from(new Set(contentTypes)),
        toolCalls: Array.from(new Set(toolCalls)),
        textSnippets: textSnippets.slice(0, 4),
        usage,
      })
    }
  }

  return {
    totalLines,
    records,
    parseErrorCount,
    entryTypeCounts,
    roleCounts,
    toolCounts,
    modelCounts,
  }
}

function resolveWorkspaceFilePath(
  workspacePath: string,
  requestedFilePath: string,
): {
  absolutePath: string
  relativePath: string
} {
  const candidateRelative = requestedFilePath.replaceAll("\\", "/").replace(/^\/+/, "")
  const absolutePath = path.resolve(workspacePath, candidateRelative)
  if (!isPathInside(workspacePath, absolutePath)) {
    throw new Error("Requested file path is outside workspace")
  }

  const relativePath = normalizeRelativePath(path.relative(workspacePath, absolutePath))
  return {
    absolutePath,
    relativePath,
  }
}

async function buildWorkspaceFileContent(options: {
  workspacePath: string
  requestedFilePath: string
  offset: number
  limit: number
}): Promise<Record<string, unknown>> {
  const resolved = resolveWorkspaceFilePath(options.workspacePath, options.requestedFilePath)
  if (!(await pathExists(resolved.absolutePath))) {
    throw new Error(`File not found: ${resolved.relativePath}`)
  }

  const stat = await fs.lstat(resolved.absolutePath)
  const extension = path.extname(resolved.relativePath).toLowerCase() || "(none)"
  const tags = classifyEntryTags(resolved.relativePath, stat.isDirectory() ? "directory" : "file")

  if (stat.isDirectory()) {
    const children = await fs.readdir(resolved.absolutePath, { withFileTypes: true })
    children.sort((a, b) => a.name.localeCompare(b.name))
    return {
      path: resolved.relativePath,
      kind: "directory",
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
      extension,
      tags,
      view: {
        type: "directory",
        children: children.map((entry) => ({
          name: entry.name,
          kind: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
        })),
      },
    }
  }

  if (!stat.isFile()) {
    return {
      path: resolved.relativePath,
      kind: "other",
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
      extension,
      tags,
      view: {
        type: "unsupported",
        message: "This entry is not a regular file.",
      },
    }
  }

  const prefix = await readFilePrefix(resolved.absolutePath, binaryPreviewBytes)
  const lowerPath = resolved.relativePath.toLowerCase()
  const binary = !textFileExtensions.has(extension) && isLikelyBinary(prefix)

  if (lowerPath.endsWith("session.jsonl")) {
    const window = await readSessionWindow(resolved.absolutePath, options.offset, options.limit)
    return {
      path: resolved.relativePath,
      kind: "file",
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
      extension,
      tags,
      view: {
        type: "session_jsonl",
        offset: options.offset,
        limit: options.limit,
        totalLines: window.totalLines,
        hasMore: options.offset + window.records.length < window.totalLines,
        records: window.records,
        stats: {
          parseErrorCount: window.parseErrorCount,
          entryTypeCounts: window.entryTypeCounts,
          roleCounts: window.roleCounts,
          toolCounts: window.toolCounts,
          modelCounts: window.modelCounts,
        },
      },
    }
  }

  if (lowerPath.endsWith(".jsonl")) {
    const textWindow = await readTextWindow(resolved.absolutePath, options.offset, options.limit)
    const records = textWindow.lines.map((line, index) => {
      const lineNumber = options.offset + index + 1
      try {
        const parsed = JSON.parse(line) as unknown
        return {
          lineNumber,
          ok: true,
          preview: truncate(safeJson(parsed), 200),
        }
      } catch {
        return {
          lineNumber,
          ok: false,
          preview: truncate(line, 200),
        }
      }
    })

    return {
      path: resolved.relativePath,
      kind: "file",
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
      extension,
      tags,
      view: {
        type: "jsonl",
        offset: options.offset,
        limit: options.limit,
        totalLines: textWindow.totalLines,
        hasMore: textWindow.hasMore,
        records,
      },
    }
  }

  if (!binary) {
    const textWindow = await readTextWindow(resolved.absolutePath, options.offset, options.limit)
    const viewType = extension === ".md" ? "markdown" : extension === ".json" ? "json" : "text"

    return {
      path: resolved.relativePath,
      kind: "file",
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
      extension,
      tags,
      view: {
        type: viewType,
        offset: options.offset,
        limit: options.limit,
        totalLines: textWindow.totalLines,
        hasMore: textWindow.hasMore,
        lines: textWindow.lines,
      },
    }
  }

  return {
    path: resolved.relativePath,
    kind: "file",
    size: stat.size,
    updatedAt: stat.mtime.toISOString(),
    extension,
    tags,
    view: {
      type: "binary",
      bytesRead: prefix.length,
      hexPreview: toHexPreview(prefix),
    },
  }
}

async function buildWorkspaceSummary(workspacePath: string): Promise<WorkspaceSummary> {
  const manifestPath = path.join(workspacePath, "manifest.json")
  const coordinatorDir = path.join(workspacePath, "coordinator")
  const coordinatorStatePath = path.join(coordinatorDir, "state.json")
  const coordinatorSessionPath = path.join(coordinatorDir, "session.jsonl")
  const solversRoot = path.join(coordinatorDir, "solvers")

  const manifest = (await readJsonFile<Record<string, unknown>>(manifestPath)) ?? {}
  const coordinatorState = (await readJsonFile<Record<string, unknown>>(coordinatorStatePath)) ?? {}
  const coordinatorSession = await readSessionStats(coordinatorSessionPath)

  const modelSlots = summarizeModelSlots(coordinatorState.modelPool, manifest.modelPool)

  const challengeQueue = Array.isArray(coordinatorState.challengeQueue)
    ? coordinatorState.challengeQueue
        .filter(
          (item): item is Record<string, unknown> => typeof item === "object" && item !== null,
        )
        .map((item) => ({
          challengeId: typeof item.challengeId === "string" ? item.challengeId : undefined,
          challengeName: typeof item.challengeName === "string" ? item.challengeName : undefined,
          category: typeof item.category === "string" ? item.category : undefined,
          difficulty: typeof item.difficulty === "number" ? item.difficulty : undefined,
          description: typeof item.description === "string" ? item.description : undefined,
        }))
    : []

  const solverDirEntries = (await pathExists(solversRoot))
    ? await fs.readdir(solversRoot, { withFileTypes: true })
    : []

  const discoveredSolverIds = solverDirEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
  const manifestSolverIds = Array.isArray(manifest.solverIds)
    ? manifest.solverIds.filter((item): item is string => typeof item === "string")
    : []

  const solverIds = Array.from(new Set([...manifestSolverIds, ...discoveredSolverIds])).sort(
    (a, b) => {
      const left = Number.parseInt(a, 10)
      const right = Number.parseInt(b, 10)
      if (Number.isNaN(left) || Number.isNaN(right)) {
        return a.localeCompare(b)
      }
      return left - right
    },
  )

  const solvers: SolverSummary[] = []
  for (const solverId of solverIds) {
    const solverDir = path.join(solversRoot, solverId)
    const statePath = path.join(solverDir, "state.json")
    const sessionPath = path.join(solverDir, "session.jsonl")
    const writeupPath = path.join(solverDir, "Writeups.md")
    const scriptsDir = path.join(solverDir, "scripts")
    const attachmentsDir = path.join(solverDir, "attachments")

    const state = (await readJsonFile<Record<string, unknown>>(statePath)) ?? {}
    const session = await readSessionStats(sessionPath)
    const writeupLines = await countWriteupLines(writeupPath)
    const scriptFileCount = await countFilesRecursive(scriptsDir)
    const attachmentFileCount = await countFilesRecursive(attachmentsDir)

    solvers.push({
      solverId,
      challengeName: typeof state.challengeName === "string" ? state.challengeName : undefined,
      category: typeof state.category === "string" ? state.category : undefined,
      status: normalizeSolverStatus(state.status),
      model: typeof state.model === "string" ? state.model : undefined,
      updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : undefined,
      lastAgentEndReason:
        typeof state.lastAgentEndReason === "string" ? state.lastAgentEndReason : undefined,
      lastAgentEndAt: typeof state.lastAgentEndAt === "string" ? state.lastAgentEndAt : undefined,
      latestSubmittedFlag:
        typeof state.latestSubmittedFlag === "string"
          ? state.latestSubmittedFlag
          : typeof state.flag === "string"
            ? state.flag
            : undefined,
      lastRejectedFlag:
        typeof state.lastRejectedFlag === "string" ? state.lastRejectedFlag : undefined,
      details:
        typeof state.details === "string"
          ? state.details
          : typeof state.message === "string"
            ? state.message
            : undefined,
      cwd: typeof state.cwd === "string" ? state.cwd : undefined,
      writeupLines,
      scriptFileCount,
      attachmentFileCount,
      session,
    })
  }

  const statusCounts: CountMap = {}
  const categoryCounts: CountMap = {}
  const modelCounts: CountMap = {}
  let submittedFlagCount = 0
  let rejectedFlagCount = 0

  for (const solver of solvers) {
    addCount(statusCounts, solver.status)
    addCount(categoryCounts, solver.category ?? "unknown")
    addCount(modelCounts, solver.model ?? "unknown")
    if (solver.latestSubmittedFlag) submittedFlagCount += 1
    if (solver.lastRejectedFlag) rejectedFlagCount += 1
  }

  const sessionList = [coordinatorSession, ...solvers.map((solver) => solver.session)]
  const mergedToolCalls = mergeCountMaps(...sessionList.map((item) => item.toolCalls))
  const mergedTimeline = mergeCountMaps(...sessionList.map((item) => item.timeline))
  const topTools = toSortedEntries(mergedToolCalls).slice(0, 12)

  const totalMessages = sessionList.reduce((sum, item) => sum + item.messageCount, 0)
  const totalToolCalls = sessionList.reduce(
    (sum, item) => sum + Object.values(item.toolCalls).reduce((acc, value) => acc + value, 0),
    0,
  )
  const totalTokens = sessionList.reduce((sum, item) => sum + item.totalTokens, 0)
  const totalCost = sessionList.reduce((sum, item) => sum + item.totalCost, 0)

  return {
    generatedAt: new Date().toISOString(),
    workspace: {
      id: typeof manifest.id === "string" ? manifest.id : path.basename(workspacePath),
      name: typeof manifest.name === "string" ? manifest.name : path.basename(workspacePath),
      path: workspacePath,
      createdAt: typeof manifest.createdAt === "string" ? manifest.createdAt : undefined,
      updatedAt: typeof manifest.updatedAt === "string" ? manifest.updatedAt : undefined,
    },
    coordinator: {
      stateUpdatedAt:
        typeof coordinatorState.updatedAt === "string" ? coordinatorState.updatedAt : undefined,
      queueSize: challengeQueue.length,
      modelSlots,
      challengeQueue,
      session: coordinatorSession,
    },
    solvers: solvers.sort((a, b) =>
      a.solverId.localeCompare(b.solverId, undefined, { numeric: true }),
    ),
    aggregates: {
      solverCount: solvers.length,
      queueSize: challengeQueue.length,
      submittedFlagCount,
      rejectedFlagCount,
      totalMessages,
      totalToolCalls,
      totalTokens,
      totalCost,
      statusCounts,
      categoryCounts,
      modelCounts,
      topTools,
      timeline: toSortedEntries(mergedTimeline).map(({ name, count }) => ({
        bucket: name,
        count,
      })),
    },
  }
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader("content-type", "application/json; charset=utf-8")
  res.end(JSON.stringify(payload))
}

function createWorkspaceApiPlugin(): Plugin {
  return {
    name: "misuzu-workspace-api",
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        if (!req.url) {
          next()
          return
        }

        const url = new URL(req.url, "http://localhost")

        try {
          if (url.pathname === "/api/workspaces") {
            const workspaces = await getWorkspaceList()
            const defaultPath = resolveWorkspaceCandidate(null, workspaces)
            sendJson(res, 200, {
              ok: true,
              workspaces,
              defaultPath,
            })
            return
          }

          if (url.pathname === "/api/workspace-summary") {
            const workspaces = await getWorkspaceList()
            const requestedPath = url.searchParams.get("path")
            const workspacePath = resolveWorkspaceCandidate(requestedPath, workspaces)

            if (!(await pathExists(path.join(workspacePath, "manifest.json")))) {
              sendJson(res, 404, {
                ok: false,
                error: `Workspace not found: ${workspacePath}`,
              })
              return
            }

            const summary = await buildWorkspaceSummary(workspacePath)
            sendJson(res, 200, { ok: true, summary })
            return
          }

          if (url.pathname === "/api/workspace-files") {
            const workspaces = await getWorkspaceList()
            const requestedPath = url.searchParams.get("path")
            const workspacePath = resolveWorkspaceCandidate(requestedPath, workspaces)

            if (!(await pathExists(path.join(workspacePath, "manifest.json")))) {
              sendJson(res, 404, {
                ok: false,
                error: `Workspace not found: ${workspacePath}`,
              })
              return
            }

            const index = await buildWorkspaceFileIndex(workspacePath)
            sendJson(res, 200, {
              ok: true,
              workspacePath,
              index: {
                totalFiles: index.totalFiles,
                totalDirectories: index.totalDirectories,
                totalSymlinks: index.totalSymlinks,
                totalBytes: index.totalBytes,
                extensionCounts: toSortedEntries(index.extensionCounts),
                tagCounts: toSortedEntries(index.tagCounts),
                largestFiles: index.largestFiles,
              },
              entries: index.entries,
            })
            return
          }

          if (url.pathname === "/api/workspace-file") {
            const workspaces = await getWorkspaceList()
            const requestedPath = url.searchParams.get("path")
            const workspacePath = resolveWorkspaceCandidate(requestedPath, workspaces)
            const filePath = url.searchParams.get("file")

            if (!filePath || filePath.trim().length === 0) {
              sendJson(res, 400, {
                ok: false,
                error: "Query `file` is required",
              })
              return
            }

            const offset = parseWindowNumber(url.searchParams.get("offset"), 0, 0, 1_000_000)
            const requestedLimit = parseWindowNumber(
              url.searchParams.get("limit"),
              textWindowDefaultLimit,
              20,
              textWindowMaxLimit,
            )

            const sessionLimit = parseWindowNumber(
              url.searchParams.get("sessionLimit"),
              sessionWindowDefaultLimit,
              20,
              sessionWindowMaxLimit,
            )

            const lowerPath = filePath.toLowerCase().replaceAll("\\", "/")
            const limit = lowerPath.endsWith("session.jsonl") ? sessionLimit : requestedLimit

            const content = await buildWorkspaceFileContent({
              workspacePath,
              requestedFilePath: filePath,
              offset,
              limit,
            })

            sendJson(res, 200, {
              ok: true,
              workspacePath,
              content,
            })
            return
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unexpected workspace API error"
          sendJson(res, 500, { ok: false, error: message })
          return
        }

        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [createWorkspaceApiPlugin()],
})
