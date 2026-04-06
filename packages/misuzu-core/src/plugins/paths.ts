import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { resolveMisuzuRoot } from "../utils/path.ts"

const BUILTIN_PLUGIN_CATALOG_NAME = "catalog.json"
const BUILTIN_PLUGIN_OVERRIDE_ENV = "MISUZU_BUILTIN_PLUGIN_DIR"

export function resolveBuiltinPluginWorkspaceDir() {
  const overrideDir = process.env[BUILTIN_PLUGIN_OVERRIDE_ENV]?.trim()
  if (overrideDir) {
    return resolve(overrideDir)
  }

  const moduleDir = dirname(fileURLToPath(import.meta.url))

  const workspaceRoot = resolveMisuzuRoot(moduleDir)
  if (workspaceRoot) {
    const monorepoCandidate = join(workspaceRoot, "plugins")
    if (existsSync(join(monorepoCandidate, BUILTIN_PLUGIN_CATALOG_NAME))) {
      return monorepoCandidate
    }
  }

  throw "No plugins/ folder!"
}

export function resolveBuiltinPluginCatalogPath() {
  return join(resolveBuiltinPluginWorkspaceDir(), BUILTIN_PLUGIN_CATALOG_NAME)
}
