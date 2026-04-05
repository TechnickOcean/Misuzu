import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const PACKAGE_ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const BUILTIN_PLUGIN_WORKSPACE_DIR = join(PACKAGE_ROOT_DIR, "plugins")
const BUILTIN_PLUGIN_CATALOG_PATH = join(BUILTIN_PLUGIN_WORKSPACE_DIR, "catalog.json")

export function resolveBuiltinPluginWorkspaceDir() {
  return BUILTIN_PLUGIN_WORKSPACE_DIR
}

export function resolveBuiltinPluginCatalogPath() {
  return BUILTIN_PLUGIN_CATALOG_PATH
}
