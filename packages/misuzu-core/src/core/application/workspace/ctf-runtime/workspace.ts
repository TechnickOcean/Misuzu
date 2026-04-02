import { resolveWorkspacePaths } from "../shared/paths.ts"
import type { Container } from "../../../infrastructure/di/container.ts"
import {
  BaseWorkspace,
  type WorkspaceOptions,
  createWorkspaceContainer,
} from "../base/workspace.ts"
import { CTFRuntimePersistence } from "./persistence.ts"
import type { PersistedCTFRuntimeState } from "./state.ts"

const runtimeWorkspaceRegistry = new Map<string, CTFRuntimeWorkspace>()

export interface CTFRuntime {
  runtimeId: string
  getPersistedState: () => Record<string, unknown>
  restoreFromPersistedState?: (state: Record<string, unknown>) => Promise<void> | void
  shutdown?: () => Promise<void> | void
}

export class CTFRuntimeWorkspace extends BaseWorkspace {
  runtime?: CTFRuntime

  private readonly runtimePersistence: CTFRuntimePersistence
  private pendingRuntimeState?: PersistedCTFRuntimeState

  constructor(rootDir: string, container: Container) {
    super(rootDir, container)
    this.runtimePersistence = new CTFRuntimePersistence(this.logger)
  }

  override async initPersistence() {
    await this.runtimePersistence.initialize(this.rootDir)
    const state = this.runtimePersistence.getState()
    this.pendingRuntimeState = state?.runtimeState
  }

  async attachRuntime(runtime: CTFRuntime) {
    this.runtime = runtime

    if (
      this.pendingRuntimeState &&
      this.pendingRuntimeState.runtimeId === runtime.runtimeId &&
      runtime.restoreFromPersistedState
    ) {
      await runtime.restoreFromPersistedState(this.pendingRuntimeState.payload)
    }

    this.pendingRuntimeState = undefined
  }

  async persistRuntimeState() {
    if (!this.runtimePersistence.isInitialized) {
      throw new Error("CTFRuntimeWorkspace persistence is not initialized")
    }

    if (!this.runtime) {
      throw new Error("CTFRuntimeWorkspace has no attached runtime")
    }

    await this.runtimePersistence.saveRuntimeState({
      runtimeId: this.runtime.runtimeId,
      payload: this.runtime.getPersistedState(),
    })
  }

  async clearRuntimeState() {
    if (!this.runtimePersistence.isInitialized) {
      throw new Error("CTFRuntimeWorkspace persistence is not initialized")
    }

    await this.runtimePersistence.clear()
    this.pendingRuntimeState = undefined
  }

  override async shutdown() {
    if (this.runtime && this.runtimePersistence.isInitialized) {
      await this.persistRuntimeState()
    }

    await this.runtime?.shutdown?.()

    this.logger.info("[CTFRuntimeWorkspace] Workspace shutdown completed")
  }
}

export function createCTFRuntimeWorkspaceWithoutPersistence(options: WorkspaceOptions = {}) {
  const rootDir = options.rootDir ?? process.cwd()
  const paths = resolveWorkspacePaths(rootDir)
  return new CTFRuntimeWorkspace(
    paths.rootDir,
    createWorkspaceContainer(paths.rootDir, options.configureContainer),
  )
}

export async function createCTFRuntimeWorkspace(options: WorkspaceOptions = {}) {
  const workspace = createCTFRuntimeWorkspaceWithoutPersistence(options)
  await workspace.initPersistence()
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
