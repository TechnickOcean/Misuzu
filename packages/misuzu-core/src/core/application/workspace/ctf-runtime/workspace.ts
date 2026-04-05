import { join } from "node:path"
import {
  EnvironmentAgent,
  createDefaultEnvironmentAgent,
  type EnvironmentAgentOptions,
} from "../../../../agents/environment.ts"
import { SolverAgent, type SolverAgentOptions } from "../../../../agents/solver.ts"
import { listBuiltinPlugins, type BuiltinPluginCatalogEntry } from "../../../../plugins/catalog.ts"
import { resolveWorkspacePaths } from "../shared/paths.ts"
import type { Container } from "../../../infrastructure/di/container.ts"
import { loggerToken, providerRegistryToken } from "../../../infrastructure/di/tokens.ts"
import { ProviderRegistry } from "../../providers/index.ts"
import type { SolverWorkspace } from "../solver/workspace.ts"
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
import type { PersistedCTFRuntimeState } from "./state.ts"

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
  private readonly providerBootstrap: ProxyProviderBootstrap

  private readonly queue: QueueService
  private readonly solverHub: SolverHub
  private readonly orchestrator: RuntimeOrchestrator
  private readonly solverWorkspaces: SolverWorkspaceService

  constructor(rootDir: string, container: Container) {
    super(rootDir, container)
    this.runtimePersistence = new CTFRuntimePersistence(this.logger)
    this.providerBootstrap = new ProxyProviderBootstrap({
      logger: this.logger,
      providers: this.providers,
      providerConfigPath: this.providerConfigPath,
      logPrefix: "[CTFRuntimeWorkspace]",
    })
    this.queue = this.container.resolve(queueToken)
    this.solverHub = this.container.resolve(solverHubToken)
    this.orchestrator = this.container.resolve(orchestratorToken)
    this.solverWorkspaces = this.container.resolve(solverWorkspaceServiceToken)
  }

  override async initPersistence() {
    await this.runtimePersistence.initialize(this.rootDir)
    const state = this.runtimePersistence.getState()
    this.pendingRuntimeState = state?.runtimeState
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

  async deriveSolverWorkspace(solverId: string): Promise<SolverWorkspace> {
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
    return listBuiltinPlugins()
  }

  getManagedChallengeIds() {
    return this.solverHub.getManagedChallengeIds()
  }

  getChallengeSolver(challengeId: number) {
    return this.solverHub.getChallengeSolver(challengeId)
  }

  async initializeRuntime(options: RuntimeInitOptions) {
    await this.orchestrator.initialize(options, {
      registerCronJob: (name, intervalMs, handler) => {
        this.registerCronJob(name, intervalMs, handler)
      },
    })
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
    await this.solverWorkspaces.shutdown()
    await super.shutdown()

    this.logger.info("[CTFRuntimeWorkspace] Workspace shutdown completed")
  }
}

function registerCTFRuntimeServices(container: Container, rootDir: string) {
  container.registerSingleton(queueToken, () => new QueueService())
  container.registerSingleton(solverWorkspaceServiceToken, (currentContainer) => {
    return new SolverWorkspaceService({
      rootDir,
      logger: currentContainer.resolve(loggerToken),
    })
  })

  container.registerSingleton(solverHubToken, (currentContainer) => {
    return new SolverHub({
      logger: currentContainer.resolve(loggerToken),
      queue: currentContainer.resolve(queueToken),
      solverWorkspaces: currentContainer.resolve(solverWorkspaceServiceToken),
    })
  })

  container.registerSingleton(syncToken, (currentContainer) => {
    return new SyncService({
      logger: currentContainer.resolve(loggerToken),
      solverHub: currentContainer.resolve(solverHubToken),
    })
  })

  container.registerSingleton(orchestratorToken, (currentContainer) => {
    return new RuntimeOrchestrator({
      logger: currentContainer.resolve(loggerToken),
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

  if (options.runtime) {
    await workspace.initializeRuntime(options.runtime)
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
