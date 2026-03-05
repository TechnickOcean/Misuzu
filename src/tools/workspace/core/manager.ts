import { randomBytes } from "node:crypto"
import * as fs from "node:fs/promises"
import { join } from "node:path"
import sanitize from "sanitize-filename"
import { TMP_DIR } from "@/consts"
import { AppError } from "@/utils/errors"

export type WorkspaceConfig = {
  id: string
  title: string
  path: string
  created_at: string
}

export type WorkspaceRecord = WorkspaceConfig

export type KnowledgeEntry = {
  id: string
  title: string
  summary: string
  source: string
  path: string
}

const MISUZU_DIR = ".misuzu"
const CONFIG_NAME = "config.json"
const KNOWLEDGE_NAME = "knowledge.json"
const REMOVE_RETRY_DELAY_MS = 120
const REMOVE_MAX_RETRIES = 5

function randomChars(byte: number) {
  return randomBytes(byte).toString("hex")
}

async function exists(targetPath: string) {
  try {
    await fs.stat(targetPath)
    return true
  } catch {
    return false
  }
}

function buildWorkspacePath(id: string) {
  return join(TMP_DIR, id)
}

function buildMisuzuPath(basePath: string) {
  return join(basePath, MISUZU_DIR)
}

function buildConfigPath(basePath: string) {
  return join(basePath, MISUZU_DIR, CONFIG_NAME)
}

function buildKnowledgePath(basePath: string) {
  return join(basePath, MISUZU_DIR, KNOWLEDGE_NAME)
}

async function readJsonFile<T>(filePath: string) {
  const raw = await fs.readFile(filePath, "utf-8")
  return JSON.parse(raw) as T
}

async function writeJsonFile(filePath: string, data: unknown) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8")
}

async function ensureWorkspaceFiles(basePath: string) {
  const misuzuPath = buildMisuzuPath(basePath)
  await fs.mkdir(basePath, { recursive: true })
  await fs.mkdir(misuzuPath, { recursive: true })

  const knowledgePath = buildKnowledgePath(basePath)

  if (!(await exists(knowledgePath))) {
    await writeJsonFile(knowledgePath, [])
  }
}

async function readWorkspaceConfig(id: string) {
  const basePath = buildWorkspacePath(id)
  const configPath = buildConfigPath(basePath)
  if (!(await exists(configPath))) {
    throw new AppError("NOT_FOUND", "Workspace not found", { id })
  }
  return await readJsonFile<WorkspaceConfig>(configPath)
}

async function removeWorkspacePath(basePath: string) {
  if (!(await exists(basePath))) return
  let attempt = 0
  while (attempt < REMOVE_MAX_RETRIES) {
    try {
      await fs.rm(basePath, { recursive: true, force: true })
      return
    } catch (error) {
      const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined
      if (code && ["EBUSY", "EPERM", "ENOTEMPTY"].includes(code)) {
        attempt += 1
        await new Promise((resolve) => setTimeout(resolve, REMOVE_RETRY_DELAY_MS))
        continue
      }
      throw error
    }
  }
  if (await exists(basePath)) {
    throw new AppError("UPSTREAM_ERROR", "Failed to delete workspace directory", { path: basePath })
  }
}

async function readKnowledgeByPath(basePath: string) {
  const knowledgePath = buildKnowledgePath(basePath)
  if (!(await exists(knowledgePath))) return []
  const parsed = await readJsonFile<KnowledgeEntry[]>(knowledgePath)
  return Array.isArray(parsed) ? parsed : []
}

async function resolveUniqueId(base: string, forceSuffix: boolean) {
  const safeBase = sanitize(base).trim() || "workspace"
  let next = forceSuffix ? `${safeBase}-${randomChars(4)}` : safeBase
  while (await exists(buildWorkspacePath(next))) {
    next = `${safeBase}-${randomChars(4)}`
  }
  return next
}

export async function createWorkspace({ title, id }: { title: string; id?: string }): Promise<WorkspaceRecord> {
  const nextId = id ? await resolveUniqueId(id, false) : await resolveUniqueId(title, true)
  const basePath = buildWorkspacePath(nextId)
  await ensureWorkspaceFiles(basePath)

  const config: WorkspaceConfig = {
    id: nextId,
    title,
    path: basePath,
    created_at: new Date().toISOString()
  }
  await writeJsonFile(buildConfigPath(basePath), config)

  return { ...config }
}

export async function getWorkspace({ id }: { id: string }): Promise<WorkspaceRecord> {
  const config = await readWorkspaceConfig(id)
  return { ...config }
}

export async function listWorkspaces(): Promise<WorkspaceRecord[]> {
  const entries = await fs.readdir(TMP_DIR, { withFileTypes: true })
  const results: WorkspaceRecord[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const basePath = buildWorkspacePath(entry.name)
    const configPath = buildConfigPath(basePath)
    if (!(await exists(configPath))) continue
    try {
      const config = await readJsonFile<WorkspaceConfig>(configPath)
      results.push({ ...config })
    } catch {}
  }

  return results
}

export async function updateWorkspaceConfig({ id, data }: { id: string; data: Partial<WorkspaceConfig> }) {
  const config = await readWorkspaceConfig(id)
  const next: WorkspaceConfig = {
    ...config,
    ...data,
    id: config.id
  }
  await writeJsonFile(buildConfigPath(config.path), next)
  return next
}

export async function appendWorkspaceKnowledge({ id, entry }: { id: string; entry: KnowledgeEntry }) {
  const config = await readWorkspaceConfig(id)
  await ensureWorkspaceFiles(config.path)
  const knowledge = await readKnowledgeByPath(config.path)
  const nextKnowledge = [...knowledge, entry]
  await writeJsonFile(buildKnowledgePath(config.path), nextKnowledge)
}

export async function deleteWorkspace({ id }: { id: string }) {
  const basePath = buildWorkspacePath(id)
  if (!(await exists(basePath))) {
    throw new AppError("NOT_FOUND", "Workspace not found", { id })
  }
  await removeWorkspacePath(basePath)
  return { id, deleted: true }
}
