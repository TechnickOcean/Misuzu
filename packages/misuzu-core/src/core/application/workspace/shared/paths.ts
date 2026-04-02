import { join, resolve } from "node:path"

const WORKSPACE_MARKER_DIR = ".misuzu"
const WORKSPACE_PROVIDER_CONFIG_FILE = "providers.json"
const WORKSPACE_SKILLS_DIR = "skills"

export function resolveWorkspacePaths(rootDir: string) {
  const workspaceRootDir = resolve(rootDir)
  const markerDir = join(workspaceRootDir, WORKSPACE_MARKER_DIR)

  return {
    rootDir: workspaceRootDir,
    markerDir,
    skillsRootDir: join(markerDir, WORKSPACE_SKILLS_DIR),
    providerConfigPath: join(markerDir, WORKSPACE_PROVIDER_CONFIG_FILE),
  }
}
