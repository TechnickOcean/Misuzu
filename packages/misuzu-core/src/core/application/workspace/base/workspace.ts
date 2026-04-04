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

interface WorkspaceCronJob {
  name: string
  intervalMs: number
  running: boolean
  timer: NodeJS.Timeout
  handler: () => Promise<void> | void
}

export interface RegisterCronJobOptions {
  runOnStart?: boolean
}

export class BaseWorkspace {
  readonly rootDir: string
  readonly markerDir: string
  readonly skillsRootDir: string
  readonly providerConfigPath: string

  protected readonly container: Container
  private readonly cronJobs = new Map<string, WorkspaceCronJob>()

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

  protected registerCronJob(
    name: string,
    intervalMs: number,
    handler: () => Promise<void> | void,
    options: RegisterCronJobOptions = {},
  ) {
    if (intervalMs <= 0) {
      throw new Error(`[Workspace] Invalid cron interval for job ${name}: ${String(intervalMs)}`)
    }

    this.unregisterCronJob(name)

    const job: WorkspaceCronJob = {
      name,
      intervalMs,
      handler,
      running: false,
      timer: setInterval(() => {
        void this.runCronJob(name)
      }, intervalMs),
    }

    job.timer.unref?.()
    this.cronJobs.set(name, job)

    this.logger.info("[Workspace] Cron job registered", { name, intervalMs })

    if (options.runOnStart) {
      void this.runCronJob(name)
    }
  }

  protected unregisterCronJob(name: string) {
    const existing = this.cronJobs.get(name)
    if (!existing) {
      return
    }

    clearInterval(existing.timer)
    this.cronJobs.delete(name)
    this.logger.info("[Workspace] Cron job unregistered", { name })
  }

  protected async runCronJob(name: string) {
    const job = this.cronJobs.get(name)
    if (!job) {
      return
    }

    if (job.running) {
      return
    }

    job.running = true
    try {
      await job.handler()
    } catch (error) {
      this.logger.warn("[Workspace] Cron job execution failed", { name }, error)
    } finally {
      job.running = false
    }
  }

  protected clearCronJobs() {
    for (const name of this.cronJobs.keys()) {
      this.unregisterCronJob(name)
    }
  }

  async shutdown() {
    this.clearCronJobs()
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
