import { createContainer, type Container } from "../../../infrastructure/di/container.ts"
import {
  loggerToken,
  persistenceStoreToken,
  providerRegistryToken,
} from "../../../infrastructure/di/tokens.ts"
import {
  createWorkspaceLogger,
  getLogLevelFromEnv,
} from "../../../infrastructure/logging/logger.ts"
import { ConsoleLogSink } from "../../../infrastructure/logging/sinks/console-sink.ts"
import type { Logger } from "../../../infrastructure/logging/types.ts"
import { JsonFilePersistenceAdapter } from "../../persistence/adapters/json.ts"
import type { PersistenceStore } from "../../persistence/store.ts"
import { ProviderRegistry } from "../../providers/index.ts"
import { resolveWorkspacePaths } from "../shared/paths.ts"

export interface WorkspaceOptions {
  rootDir?: string
  configureContainer?: (container: Container) => void
}

export class BaseWorkspace {
  readonly rootDir: string
  readonly markerDir: string
  readonly skillsRootDir: string
  readonly providerConfigPath: string

  protected readonly container: Container

  constructor(rootDir: string, container: Container) {
    const paths = resolveWorkspacePaths(rootDir)
    this.rootDir = paths.rootDir
    this.markerDir = paths.markerDir
    this.skillsRootDir = paths.skillsRootDir
    this.providerConfigPath = paths.providerConfigPath
    this.container = container
  }

  async initPersistence() {
    const persistence = this.persistence
    await persistence.initialize(this.rootDir)

    const hasPersistedState = await persistence.hasPersistedState()
    if (hasPersistedState) {
      await this.restoreFromPersistence()
    }
  }

  protected async restoreFromPersistence() {}

  get persistence(): PersistenceStore {
    return this.container.resolve(persistenceStoreToken)
  }

  get logger(): Logger {
    return this.container.resolve(loggerToken)
  }

  protected safePersist(action: () => Promise<void>) {
    return action().catch((error) => {
      if ((error as Error).message === "PersistenceStore not initialized") {
        return
      }
      this.logger.warn("[Workspace] Failed to persist change", error)
    })
  }

  async shutdown() {
    await this.persistence.flush()
    this.logger.info("[Workspace] Workspace shutdown completed")
  }
}

export function createWorkspaceContainer(
  rootDir: string,
  configureContainer?: (container: Container) => void,
) {
  const container = createContainer()

  const logger = createWorkspaceLogger({
    level: getLogLevelFromEnv(),
    context: { workspaceRootDir: rootDir },
    sinks: [new ConsoleLogSink(process.env.MISUZU_LOG_FORMAT === "json" ? "json" : "pretty")],
  })

  container.registerSingleton(loggerToken, () => logger)
  container.registerSingleton(providerRegistryToken, () => new ProviderRegistry())
  container.registerSingleton(persistenceStoreToken, () => new JsonFilePersistenceAdapter(logger))

  configureContainer?.(container)
  return container
}
