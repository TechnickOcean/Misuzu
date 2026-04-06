import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { WorkspaceRegistryEntry } from "../../shared/protocol.ts"

const APP_ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const DATA_DIR = resolve(APP_ROOT_DIR, ".misuzu-web")
const REGISTRY_FILE_PATH = resolve(DATA_DIR, "workspace-registry.json")

export class WorkspaceRegistryStore {
  private initialized = false
  private entries: WorkspaceRegistryEntry[] = []

  get filePath() {
    return REGISTRY_FILE_PATH
  }

  async initialize() {
    if (this.initialized) {
      return
    }

    await mkdir(dirname(REGISTRY_FILE_PATH), { recursive: true })

    try {
      const raw = await readFile(REGISTRY_FILE_PATH, "utf-8")
      const parsed = JSON.parse(raw) as unknown
      this.entries = normalizeRegistryEntries(parsed)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error
      }

      this.entries = []
      await this.flush()
    }

    this.initialized = true
  }

  listEntries() {
    return [...this.entries]
  }

  getEntry(workspaceId: string) {
    return this.entries.find((entry) => entry.id === workspaceId)
  }

  async upsertEntry(nextEntry: WorkspaceRegistryEntry) {
    const currentIndex = this.entries.findIndex((entry) => entry.id === nextEntry.id)
    if (currentIndex >= 0) {
      this.entries[currentIndex] = nextEntry
    } else {
      this.entries.push(nextEntry)
    }

    await this.flush()
  }

  async removeEntry(workspaceId: string) {
    const before = this.entries.length
    this.entries = this.entries.filter((entry) => entry.id !== workspaceId)
    if (this.entries.length === before) {
      return false
    }

    await this.flush()
    return true
  }

  private async flush() {
    await mkdir(DATA_DIR, { recursive: true })
    await writeFile(REGISTRY_FILE_PATH, `${JSON.stringify(this.entries, null, 2)}\n`, "utf-8")
  }
}

function normalizeRegistryEntries(raw: unknown) {
  if (!Array.isArray(raw)) {
    return []
  }

  const entries: WorkspaceRegistryEntry[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue
    }

    const entry = item as Partial<WorkspaceRegistryEntry>
    if (
      typeof entry.id !== "string" ||
      (entry.kind !== "ctf-runtime" && entry.kind !== "solver") ||
      typeof entry.name !== "string" ||
      typeof entry.rootDir !== "string" ||
      typeof entry.createdAt !== "string" ||
      typeof entry.updatedAt !== "string"
    ) {
      continue
    }

    entries.push({
      id: entry.id,
      kind: entry.kind,
      name: entry.name,
      rootDir: entry.rootDir,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      runtime:
        entry.runtime && typeof entry.runtime === "object"
          ? {
              initialized: Boolean(entry.runtime.initialized),
              pluginId:
                typeof entry.runtime.pluginId === "string" ? entry.runtime.pluginId : undefined,
              autoOrchestrate: Boolean(entry.runtime.autoOrchestrate),
            }
          : undefined,
    })
  }

  return entries
}
