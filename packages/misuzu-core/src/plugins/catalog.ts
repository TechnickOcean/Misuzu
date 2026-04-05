import { readFileSync } from "node:fs"
import { isAbsolute, join, relative, resolve } from "node:path"
import { resolveBuiltinPluginCatalogPath, resolveBuiltinPluginWorkspaceDir } from "./paths.ts"

export interface BuiltinPluginCatalogEntry {
  id: string
  name: string
  entry: string
  description?: string
}

export function loadBuiltinPluginCatalog() {
  const catalogPath = resolveBuiltinPluginCatalogPath()
  const catalogJson = readFileSync(catalogPath, "utf-8")
  const entries = JSON.parse(catalogJson) as unknown

  if (!Array.isArray(entries)) {
    throw new Error(`Invalid plugin catalog format: expected array in ${catalogPath}`)
  }

  return entries.map((entry, index) => normalizeCatalogEntry(entry, index, catalogPath))
}

export function findBuiltinPlugin(pluginId: string) {
  return loadBuiltinPluginCatalog().find((entry) => entry.id === pluginId)
}

export function resolveBuiltinPluginEntryPath(entry: BuiltinPluginCatalogEntry) {
  const workspaceDir = resolveBuiltinPluginWorkspaceDir()
  const absolutePath = resolve(workspaceDir, entry.entry)
  const workspaceRelativePath = relative(workspaceDir, absolutePath)

  if (isAbsolute(workspaceRelativePath) || workspaceRelativePath.startsWith("..")) {
    throw new Error(`Invalid plugin catalog entry path outside workspace: ${entry.entry}`)
  }

  return absolutePath
}

function normalizeCatalogEntry(raw: unknown, index: number, catalogPath: string) {
  if (!raw || typeof raw !== "object") {
    throw new Error(`Invalid plugin catalog entry at index ${String(index)} in ${catalogPath}`)
  }

  const entry = raw as Record<string, unknown>
  if (typeof entry.id !== "string" || entry.id.trim().length === 0) {
    throw new Error(`Invalid plugin id at index ${String(index)} in ${catalogPath}`)
  }

  if (typeof entry.name !== "string" || entry.name.trim().length === 0) {
    throw new Error(`Invalid plugin name at index ${String(index)} in ${catalogPath}`)
  }

  if (typeof entry.entry !== "string" || entry.entry.trim().length === 0) {
    throw new Error(`Invalid plugin entry path at index ${String(index)} in ${catalogPath}`)
  }

  return {
    id: entry.id,
    name: entry.name,
    entry: normalizeEntryPath(entry.entry),
    description: typeof entry.description === "string" ? entry.description : undefined,
  } satisfies BuiltinPluginCatalogEntry
}

function normalizeEntryPath(entryPath: string) {
  return join(...entryPath.split(/[/\\]+/))
}
