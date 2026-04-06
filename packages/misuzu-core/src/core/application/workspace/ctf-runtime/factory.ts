import { createWorkspaceContainer } from "../base/workspace.ts"
import { resolveWorkspacePaths } from "../shared/paths.ts"
import { CTFRuntimeWorkspace, type CTFRuntimeWorkspaceOptions } from "./runtime-workspace.ts"
import { registerCTFRuntimeServices } from "./register-services.ts"

const runtimeWorkspaceRegistry = new Map<string, CTFRuntimeWorkspace>()

export function createCTFRuntimeWorkspaceWithoutPersistence(
  options: CTFRuntimeWorkspaceOptions = {},
) {
  const rootDir = options.rootDir ?? process.cwd()
  const paths = resolveWorkspacePaths(rootDir)

  return new CTFRuntimeWorkspace(
    paths.rootDir,
    createWorkspaceContainer(paths.rootDir, (container) => {
      registerCTFRuntimeServices(container, paths.rootDir)
      options.configureContainer?.(container)
    }),
  )
}

export async function createCTFRuntimeWorkspace(options: CTFRuntimeWorkspaceOptions = {}) {
  const workspace = createCTFRuntimeWorkspaceWithoutPersistence(options)
  await workspace.initPersistence()

  const runtimeOptions =
    options.runtime ??
    workspace.getPersistedRuntimeOptions() ??
    (await workspace.loadRuntimeOptionsFromPlatformConfig())
  if (runtimeOptions) {
    await workspace.initializeRuntime(runtimeOptions)
  }

  return workspace
}

export async function getCTFRuntimeWorkspace(rootDir = process.cwd()) {
  const paths = resolveWorkspacePaths(rootDir)
  const existing = runtimeWorkspaceRegistry.get(paths.rootDir)
  if (existing) {
    return existing
  }

  const workspace = await createCTFRuntimeWorkspace({ rootDir: paths.rootDir })
  runtimeWorkspaceRegistry.set(paths.rootDir, workspace)
  return workspace
}
