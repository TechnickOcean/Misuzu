import { join } from "node:path"
import {
  EnvironmentAgent,
  createDefaultEnvironmentAgent,
  type EnvironmentAgentOptions,
} from "../../../../agents/environment.ts"
import { SolverAgent, type SolverAgentOptions } from "../../../../agents/solver.ts"
import {
  loadBuiltinPluginCatalog,
  type BuiltinPluginCatalogEntry,
} from "../../../../plugins/catalog.ts"
import { resolveWorkspacePaths } from "../shared/paths.ts"
import type { Container } from "../../../infrastructure/di/container.ts"
import { loggerToken, providerRegistryToken } from "../../../infrastructure/di/tokens.ts"
import { ProviderRegistry } from "../../providers/index.ts"
import {
  BaseWorkspace,
  type WorkspaceOptions,
  createWorkspaceContainer,
} from "../base/workspace.ts"
import { ProxyProviderBootstrap } from "../shared/proxy-provider-bootstrap.ts"
import { CTFRuntimePersistence } from "./persistence.ts"
import {
  RuntimeOrchestrator,
  SolverHub,
  SyncService,
  QueueService,
  SolverWorkspaceService,
  orchestratorToken,
  queueToken,
  solverHubToken,
  solverWorkspaceServiceToken,
  syncToken,
  type RuntimeCronOptions,
  type RuntimeInitOptions,
  type SolverRunner,
  type SolverTask,
  type SolverTaskResult,
} from "./services/index.ts"
import {
  CTF_RUNTIME_STATE_VERSION,
  type PersistedCTFRuntimeConfig,
  type PersistedCTFRuntimeSnapshot,
  type PersistedCTFRuntimeState,
} from "./state.ts"

const runtimeWorkspaceRegistry = new Map<string, CTFRuntimeWorkspace>()

export interface CTFRuntimeWorkspaceOptions extends WorkspaceOptions {
  runtime?: RuntimeInitOptions
}

export interface CTFRuntime {
  runtimeId: string
  getPersistedState: () => Record<string, unknown>
  restoreFromPersistedState?: (state: Record<string, unknown>) => Promise<void> | void
  shutdown?: () => Promise<void> | void
}

export type CTFSolverTask = SolverTask
export type CTFSolverTaskResult = SolverTaskResult
export type CTFSolver = SolverRunner

export class CTFRuntimeWorkspace extends BaseWorkspace {
  runtime?: CTFRuntime

  private readonly runtimePersistence: CTFRuntimePersistence
  private pendingRuntimeState?: PersistedCTFRuntimeState
  private pendingRuntimeSnapshot?: PersistedCTFRuntimeSnapshot
  private runtimeConfig?: PersistedCTFRuntimeConfig
  private runtimeInitialized = false
  private persistRuntimeTimer?: NodeJS.Timeout
  private readonly providerBootstrap: ProxyProviderBootstrap

  private readonly queue: QueueService
  private readonly solverHub: SolverHub
  private readonly orchestrator: RuntimeOrchestrator
  private readonly solverWorkspaces: SolverWorkspaceService

  constructor(rootDir: string, container: Container) {
    super(rootDir, container)
    this.runtimePersistence = new CTFRuntimePersistence(
      this.logger.child({ component: "CTFRuntimePersistence" }),
    )
    this.providerBootstrap = new ProxyProviderBootstrap({
      logger: this.logger.child({ component: "ProxyProviderBootstrap" }),
      providers: this.providers,
      providerConfigPath: this.providerConfigPath,
    })
    this.queue = this.container.resolve(queueToken)
    this.solverHub = this.container.resolve(solverHubToken)
    this.orchestrator = this.container.resolve(orchestratorToken)
    this.solverWorkspaces = this.container.resolve(solverWorkspaceServiceToken)

    this.queue.setStateChangeListener(() => {
      this.scheduleRuntimeStatePersist()
    })
    this.solverHub.setStateChangeListener(() => {
      this.scheduleRuntimeStatePersist()
    })
  }

  override async initPersistence() {
    await this.runtimePersistence.initialize(this.rootDir)
    const state = this.runtimePersistence.getState()
    this.pendingRuntimeState = state?.runtimeState
    this.pendingRuntimeSnapshot = state?.runtime
  }

  get providers(): ProviderRegistry {
    return this.container.resolve(providerRegistryToken)
  }

  loadProxyProviderOptions() {
    return this.providerBootstrap.loadProxyProviderOptions()
  }

  bootstrapProviders() {
    return this.providerBootstrap.bootstrap()
  }

  reloadProviderConfig() {
    return this.providerBootstrap.reload()
  }

  getModel(provider: string, modelId: string) {
    return this.providers.getModel(provider, modelId)
  }

  createSolver(options: SolverAgentOptions = {}) {
    return new SolverAgent(
      {
        cwd: this.rootDir,
        logger: this.logger.child({ component: "solver-agent" }),
        providers: this.providers,
        persistence: this.persistence,
      },
      options,
    )
  }

  async deriveSolverWorkspace(solverId: string) {
    return this.solverWorkspaces.getOrCreateWorkspace(solverId)
  }

  createEnvironmentAgent(options: EnvironmentAgentOptions = {}) {
    const { workspaceBaseDir, ...agentOptions } = options

    if (!workspaceBaseDir) {
      return createDefaultEnvironmentAgent(
        {
          cwd: this.rootDir,
          logger: this.logger.child({ component: "environment-agent" }),
          providers: this.providers,
          persistence: this.persistence,
        },
        agentOptions,
      )
    }

    return new EnvironmentAgent(
      {
        cwd: workspaceBaseDir,
        logger: this.logger.child({ component: "environment-agent" }),
        providers: this.providers,
        persistence: this.persistence,
      },
      {
        ...agentOptions,
        workspaceBaseDir,
      },
    )
  }

  get platformConfigPath() {
    return join(this.markerDir, "platform.json")
  }

  listAvailablePlugins(): BuiltinPluginCatalogEntry[] {
    return loadBuiltinPluginCatalog()
  }

  getManagedChallengeIds() {
    return this.solverHub.getManagedChallengeIds()
  }

  getChallengeSolver(challengeId: number) {
    return this.solverHub.getChallengeSolver(challengeId)
  }

  async initializeRuntime(options: RuntimeInitOptions) {
    const restoreSnapshot = this.getMatchingPendingRuntimeSnapshot(options)
    if (restoreSnapshot?.queue) {
      this.queue.restoreState(restoreSnapshot.queue)
    }

    await this.orchestrator.initialize(
      {
        ...options,
        restore: {
          authSession: restoreSnapshot?.platform?.authSession,
          contestId: restoreSnapshot?.platform?.contestId,
          noticeCursor: restoreSnapshot?.sync?.noticeCursor,
        },
      },
      {
        registerCronJob: (name, intervalMs, handler) => {
          this.registerCronJob(name, intervalMs, handler)
        },
      },
    )

    this.runtimeConfig = {
      pluginId: this.solverHub.getPluginId(),
      pluginConfig: options.pluginConfig,
      cron: options.cron,
    }
    this.runtimeInitialized = true
    this.pendingRuntimeSnapshot = undefined

    if (this.runtimePersistence.isInitialized) {
      await this.persistRuntimeState()
    }
  }

  async syncChallengesOnce() {
    await this.orchestrator.syncChallengesOnce()
  }

  async syncNoticesOnce() {
    await this.orchestrator.syncNoticesOnce()
  }

  registerSolver(solver: CTFSolver) {
    this.queue.registerSolver(solver)
  }

  unregisterSolver(solverId: string) {
    this.queue.unregisterSolver(solverId)
  }

  enqueueTask(payload: unknown, taskId?: string) {
    return this.queue.enqueueTask(payload, taskId)
  }

  getSchedulerState() {
    return this.queue.getState()
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

    const runtimeState = this.runtime
      ? {
          runtimeId: this.runtime.runtimeId,
          payload: this.runtime.getPersistedState(),
        }
      : undefined

    const runtimeSnapshot = this.runtimeInitialized ? this.getRuntimeSnapshot() : undefined
    if (!runtimeState && !runtimeSnapshot) {
      throw new Error("CTFRuntimeWorkspace has no runtime state to persist")
    }

    await this.runtimePersistence.saveState({
      runtimeState,
      runtime: runtimeSnapshot,
    })
  }

  async clearRuntimeState() {
    if (!this.runtimePersistence.isInitialized) {
      throw new Error("CTFRuntimeWorkspace persistence is not initialized")
    }

    if (this.persistRuntimeTimer) {
      clearTimeout(this.persistRuntimeTimer)
      this.persistRuntimeTimer = undefined
    }

    await this.runtimePersistence.clear()
    this.pendingRuntimeState = undefined
    this.pendingRuntimeSnapshot = undefined
    this.runtimeConfig = undefined
    this.runtimeInitialized = false
  }

  override async shutdown() {
    if (this.persistRuntimeTimer) {
      clearTimeout(this.persistRuntimeTimer)
      this.persistRuntimeTimer = undefined
    }

    if ((this.runtime || this.runtimeInitialized) && this.runtimePersistence.isInitialized) {
      await this.persistRuntimeState()
    }

    await this.runtime?.shutdown?.()
    await this.solverWorkspaces.shutdown()
    await super.shutdown()

    this.logger.info("Workspace shutdown completed")
  }

  getPersistedRuntimeOptions() {
    if (!this.pendingRuntimeSnapshot) {
      return undefined
    }

    return {
      pluginId: this.pendingRuntimeSnapshot.runtimeConfig.pluginId,
      pluginConfig: this.pendingRuntimeSnapshot.runtimeConfig.pluginConfig,
      cron: this.pendingRuntimeSnapshot.runtimeConfig.cron,
    } satisfies RuntimeInitOptions
  }

  private getRuntimeSnapshot(): PersistedCTFRuntimeSnapshot {
    if (!this.runtimeConfig) {
      throw new Error(
        `CTFRuntimeWorkspace snapshot is missing runtime config (version ${CTF_RUNTIME_STATE_VERSION})`,
      )
    }

    return {
      runtimeConfig: this.runtimeConfig,
      platform: this.solverHub.getPlatformState(),
      sync: {
        noticeCursor: this.solverHub.getNoticeCursor(),
      },
      queue: this.queue.snapshotState(),
      solverHub: this.solverHub.snapshotState(),
    }
  }

  private getMatchingPendingRuntimeSnapshot(options: RuntimeInitOptions) {
    if (!this.pendingRuntimeSnapshot) {
      return undefined
    }

    const expectedPluginId = options.pluginId ?? options.plugin?.meta.id
    if (!expectedPluginId) {
      return undefined
    }

    if (this.pendingRuntimeSnapshot.runtimeConfig.pluginId !== expectedPluginId) {
      return undefined
    }

    return this.pendingRuntimeSnapshot
  }

  private scheduleRuntimeStatePersist() {
    if (!this.runtimePersistence.isInitialized || !this.runtimeInitialized) {
      return
    }

    if (this.persistRuntimeTimer) {
      clearTimeout(this.persistRuntimeTimer)
    }

    this.persistRuntimeTimer = setTimeout(() => {
      this.persistRuntimeTimer = undefined
      this.persistRuntimeState().catch((error) => {
        this.logger.warn("Failed to persist runtime state", error)
      })
    }, 600)
    this.persistRuntimeTimer.unref?.()
  }
}

function registerCTFRuntimeServices(container: Container, rootDir: string) {
  container.registerSingleton(queueToken, () => new QueueService())
  container.registerSingleton(solverWorkspaceServiceToken, (currentContainer) => {
    const logger = currentContainer
      .resolve(loggerToken)
      .child({ component: "SolverWorkspaceService" })

    return new SolverWorkspaceService({
      rootDir,
      logger,
    })
  })

  container.registerSingleton(solverHubToken, (currentContainer) => {
    const logger = currentContainer.resolve(loggerToken).child({ component: "SolverHub" })

    return new SolverHub({
      logger,
      queue: currentContainer.resolve(queueToken),
      solverWorkspaces: currentContainer.resolve(solverWorkspaceServiceToken),
    })
  })

  container.registerSingleton(syncToken, (currentContainer) => {
    const logger = currentContainer.resolve(loggerToken).child({ component: "SyncService" })

    return new SyncService({
      logger,
      solverHub: currentContainer.resolve(solverHubToken),
    })
  })

  container.registerSingleton(orchestratorToken, (currentContainer) => {
    const logger = currentContainer.resolve(loggerToken).child({ component: "RuntimeOrchestrator" })

    return new RuntimeOrchestrator({
      logger,
      solverHub: currentContainer.resolve(solverHubToken),
      syncService: currentContainer.resolve(syncToken),
    })
  })
}

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

  const runtimeOptions = options.runtime ?? workspace.getPersistedRuntimeOptions()
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

export type { RuntimeCronOptions, RuntimeInitOptions }
