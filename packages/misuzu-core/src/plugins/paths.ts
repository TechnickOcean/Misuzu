import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const PACKAGE_ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const BUILTIN_PLUGIN_WORKSPACE_DIR = join(PACKAGE_ROOT_DIR, "plugins")

export function resolveBuiltinPluginWorkspaceDir() {
  return BUILTIN_PLUGIN_WORKSPACE_DIR
}

export function resolveWorkspacePlatformPluginDir(workspaceRootDir: string) {
  return join(resolve(workspaceRootDir), ".misuzu", "platform-plugin")
}
