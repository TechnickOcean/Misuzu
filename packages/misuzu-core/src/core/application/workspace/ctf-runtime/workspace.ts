import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type { AgentEvent, AgentState } from "@mariozechner/pi-agent-core"
import {
  EnvironmentAgent,
  createDefaultEnvironmentAgent,
  type EnvironmentAgentOptions,
} from "../../../../agents/environment.ts"
import {
  loadBuiltinPluginCatalog,
  type BuiltinPluginCatalogEntry,
} from "../../../../plugins/catalog.ts"
import { resolveWorkspacePaths } from "../shared/paths.ts"
import type { Container } from "../../../infrastructure/di/container.ts"
import { loggerToken, providerRegistryToken } from "../../../infrastructure/di/tokens.ts"
import { ProviderRegistry } from "../../providers/registry.ts"
import {
  BaseWorkspace,
  type WorkspaceOptions,
  createWorkspaceContainer,
} from "../base/workspace.ts"
import { ProxyProviderBootstrap } from "../shared/proxy-provider-bootstrap.ts"
import { CTFRuntimePersistence } from "./persistence.ts"
import {
  ENVIRONMENT_AGENT_RUNTIME_ID,
  buildEnvironmentInitialStateContext,
  consumePendingEnvironmentRuntimeState,
  createPersistedEnvironmentRuntimeState,
  normalizePersistedEnvironmentRuntimeStatePayload,
} from "./environment-runtime-state.ts"
import {
  RuntimeOrchestrator,
  SolverHub,
  SyncService,
  QueueService,
  SolverWorkspaceService,
  WorkspaceModelPool,
  modelPoolToken,
  orchestratorToken,
  queueToken,
  solverHubToken,
  solverWorkspaceServiceToken,
  syncToken,
  type ModelPoolCatalogProvider,
  type ModelPoolItem,
  type ModelPoolStateSnapshot,
  type ChallengeSolverActivationState,
  type RuntimeCronOptions,
  type RuntimeInitOptions,
  type SolverRunner,
  type SolverTask,
  type SolverTaskResult,
} from "./services/index.ts"
import {
  CTF_RUNTIME_STATE_VERSION,
  type PersistedEnvironmentAgentRuntimeState,
  type PersistedCTFRuntimeConfig,
  type PersistedCTFRuntimeSnapshot,
  type PersistedCTFRuntimeState,
} from "./state.ts"

const runtimeWorkspaceRegistry = new Map<string, CTFRuntimeWorkspace>()

interface EnvironmentRestoreContext {
  restoredState?: PersistedEnvironmentAgentRuntimeState
  baseSystemPrompt?: string
  initialState: Partial<AgentState>
}

interface RuntimeRestoreContext {
  authSession?: PersistedCTFRuntimeSnapshot["platform"]["authSession"]
  contestId?: PersistedCTFRuntimeSnapshot["platform"]["contestId"]
  noticeCursor?: PersistedCTFRuntimeSnapshot["sync"]["noticeCursor"]
}

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
export type CTFSolverActivationState = ChallengeSolverActivationState

export class CTFRuntimeWorkspace extends BaseWorkspace {
  runtime?: CTFRuntime

  private readonly runtimePersistence: CTFRuntimePersistence
  private pendingRuntimeState?: PersistedCTFRuntimeState
  private pendingRuntimeSnapshot?: PersistedCTFRuntimeSnapshot
  private runtimeConfig?: PersistedCTFRuntimeConfig
  private runtimeInitialized = false
  private persistRuntimeTimer?: NodeJS.Timeout
  private unsubscribeEnvironmentAgentTracking?: () => void
  private readonly providerBootstrap: ProxyProviderBootstrap

  private readonly queue: QueueService
  private readonly solverHub: SolverHub
  private readonly orchestrator: RuntimeOrchestrator
  private readonly solverWorkspaces: SolverWorkspaceService
  private readonly modelPool: WorkspaceModelPool
  private releaseEnvironmentModelLease?: () => void

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
    this.modelPool = this.container.resolve(modelPoolToken)

    this.queue.setStateChangeListener(() => {
      this.scheduleRuntimeStatePersist()
    })
    this.solverHub.setStateChangeListener(() => {
      this.scheduleRuntimeStatePersist()
    })
  }

  override async initPersistence() {
    await this.modelPool.initialize()
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

  getModelPoolState(): ModelPoolStateSnapshot {
    return this.modelPool.getState()
  }

  listModelPoolCatalog(): ModelPoolCatalogProvider[] {
    return this.modelPool.listCatalogProviders()
  }

  async setModelPoolItems(items: ModelPoolItem[]) {
    await this.modelPool.setItems(items)
  }

  async deriveSolverWorkspace(solverId: string) {
    return this.solverWorkspaces.getOrCreateWorkspace(solverId)
  }

  createEnvironmentAgent(options: EnvironmentAgentOptions = {}) {
    const { workspaceBaseDir, ...agentOptions } = options
    const restoreContext = this.buildEnvironmentRestoreContext(agentOptions)

    const preferredModel = restoreContext.initialState.model
      ? {
          provider: restoreContext.initialState.model.provider,
          modelId: restoreContext.initialState.model.id,
        }
      : undefined
    const modelLease = this.modelPool.acquire(preferredModel)

    try {
      const environmentAgent = this.createEnvironmentAgentInstance(workspaceBaseDir, {
        ...agentOptions,
        initialState: {
          ...restoreContext.initialState,
          model: modelLease.model,
        },
      })

      this.restoreEnvironmentMessages(environmentAgent, restoreContext.restoredState)
      this.trackEnvironmentAgent(environmentAgent)
      this.attachEnvironmentRuntime(environmentAgent, restoreContext.baseSystemPrompt)
      this.replaceEnvironmentModelLease(modelLease.release)

      return environmentAgent
    } catch (error) {
      modelLease.release()
      throw error
    }
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

  getSolverActivationState(challengeId: number): CTFSolverActivationState | undefined {
    return this.solverHub.getSolverActivationState(challengeId)
  }

  listSolverActivationStates(): CTFSolverActivationState[] {
    return this.solverHub.listSolverActivationStates()
  }

  async initializeRuntime(options: RuntimeInitOptions) {
    const restoreSnapshot = this.getMatchingPendingRuntimeSnapshot(options)
    this.restoreQueueFromSnapshot(restoreSnapshot)

    await this.orchestrator.initialize(
      {
        ...options,
        restore: this.buildRuntimeRestoreContext(restoreSnapshot),
      },
      this.getRuntimeScheduler(),
    )

    this.finalizeRuntimeInitialization(options)

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
    this.ensureRuntimePersistenceInitialized()

    const runtimeState = this.getRuntimeStatePayload()
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
    this.ensureRuntimePersistenceInitialized()
    this.clearRuntimeStateTimer()

    await this.runtimePersistence.clear()
    this.pendingRuntimeState = undefined
    this.pendingRuntimeSnapshot = undefined
    this.runtimeConfig = undefined
    this.runtimeInitialized = false
  }

  override async shutdown() {
    this.clearRuntimeStateTimer()
    this.stopEnvironmentAgentTracking()
    this.releaseEnvironmentModelLease?.()
    this.releaseEnvironmentModelLease = undefined

    if (this.canPersistRuntimeStateNow()) {
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

  async loadRuntimeOptionsFromPlatformConfig() {
    try {
      const raw = await readFile(this.platformConfigPath, "utf-8")
      const parsed = JSON.parse(raw) as RuntimeInitOptions
      return resolveEnvPlaceholders(parsed) as RuntimeInitOptions
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined
      }

      this.logger.error(
        "Failed to load runtime config from platformConfigPath",
        { platformConfigPath: this.platformConfigPath },
        error,
      )
      throw error
    }
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
    if (!this.canPersistRuntimeStateNow()) {
      return
    }

    this.clearRuntimeStateTimer()

    this.persistRuntimeTimer = setTimeout(() => {
      this.persistRuntimeTimer = undefined
      this.persistRuntimeState().catch((error) => {
        this.logger.warn("Failed to persist runtime state", error)
      })
    }, 600)
    this.persistRuntimeTimer.unref?.()
  }

  private ensureRuntimePersistenceInitialized() {
    if (!this.runtimePersistence.isInitialized) {
      throw new Error("CTFRuntimeWorkspace persistence is not initialized")
    }
  }

  private canPersistRuntimeStateNow() {
    return (
      this.runtimePersistence.isInitialized && (this.runtimeInitialized || Boolean(this.runtime))
    )
  }

  private clearRuntimeStateTimer() {
    if (!this.persistRuntimeTimer) {
      return
    }

    clearTimeout(this.persistRuntimeTimer)
    this.persistRuntimeTimer = undefined
  }

  private stopEnvironmentAgentTracking() {
    this.unsubscribeEnvironmentAgentTracking?.()
    this.unsubscribeEnvironmentAgentTracking = undefined
  }

  private replaceEnvironmentModelLease(release: () => void) {
    this.releaseEnvironmentModelLease?.()
    this.releaseEnvironmentModelLease = release
  }

  private getRuntimeStatePayload() {
    if (!this.runtime) {
      return undefined
    }

    return {
      runtimeId: this.runtime.runtimeId,
      payload: this.runtime.getPersistedState(),
    } satisfies PersistedCTFRuntimeState
  }

  private restoreQueueFromSnapshot(snapshot: PersistedCTFRuntimeSnapshot | undefined) {
    if (!snapshot?.queue) {
      return
    }

    this.queue.restoreState(snapshot.queue)
  }

  private buildRuntimeRestoreContext(
    snapshot: PersistedCTFRuntimeSnapshot | undefined,
  ): RuntimeRestoreContext {
    return {
      authSession: snapshot?.platform?.authSession,
      contestId: snapshot?.platform?.contestId,
      noticeCursor: snapshot?.sync?.noticeCursor,
    }
  }

  private finalizeRuntimeInitialization(options: RuntimeInitOptions) {
    this.runtimeConfig = {
      pluginId: this.solverHub.getPluginId(),
      pluginConfig: options.pluginConfig,
      cron: options.cron,
    }
    this.runtimeInitialized = true
    this.pendingRuntimeSnapshot = undefined
  }

  private getRuntimeScheduler() {
    return {
      registerCronJob: (name: string, intervalMs: number, handler: () => Promise<void>) => {
        this.registerCronJob(name, intervalMs, handler)
      },
    }
  }

  private buildEnvironmentRestoreContext(
    agentOptions: EnvironmentAgentOptions,
  ): EnvironmentRestoreContext {
    const { restoredState, remainingRuntimeState } = consumePendingEnvironmentRuntimeState(
      this.pendingRuntimeState,
      this.logger,
    )
    this.pendingRuntimeState = remainingRuntimeState

    const { initialState, baseSystemPrompt } = buildEnvironmentInitialStateContext({
      initialState: agentOptions.initialState,
      restoredState,
      providers: this.providers,
      logger: this.logger,
    })

    return {
      restoredState,
      baseSystemPrompt,
      initialState,
    }
  }

  private createEnvironmentAgentInstance(
    workspaceBaseDir: string | undefined,
    options: EnvironmentAgentOptions,
  ) {
    if (!workspaceBaseDir) {
      return createDefaultEnvironmentAgent(this.createEnvironmentAgentDeps(this.rootDir), options)
    }

    return new EnvironmentAgent(this.createEnvironmentAgentDeps(workspaceBaseDir), {
      ...options,
      workspaceBaseDir,
    })
  }

  private createEnvironmentAgentDeps(cwd: string) {
    return {
      cwd,
      logger: this.logger.child({ component: "environment-agent" }),
      providers: this.providers,
      persistence: this.persistence,
    }
  }

  private restoreEnvironmentMessages(
    environmentAgent: EnvironmentAgent,
    restoredState: PersistedEnvironmentAgentRuntimeState | undefined,
  ) {
    if (!restoredState?.messages.length) {
      return
    }

    environmentAgent.replaceMessages(restoredState.messages)
  }

  private trackEnvironmentAgent(environmentAgent: EnvironmentAgent) {
    this.stopEnvironmentAgentTracking()
    this.unsubscribeEnvironmentAgentTracking = environmentAgent.subscribe((event: AgentEvent) => {
      if (event.type === "message_end" || event.type === "agent_end") {
        this.scheduleRuntimeStatePersist()
      }
    })
  }

  private attachEnvironmentRuntime(
    environmentAgent: EnvironmentAgent,
    baseSystemPrompt: string | undefined,
  ) {
    this.runtime = {
      runtimeId: ENVIRONMENT_AGENT_RUNTIME_ID,
      getPersistedState: () =>
        createPersistedEnvironmentRuntimeState(environmentAgent, baseSystemPrompt),
      restoreFromPersistedState: (payload) => {
        const state = normalizePersistedEnvironmentRuntimeStatePayload(payload, this.logger)
        if (!state?.messages.length) {
          return
        }

        environmentAgent.replaceMessages(state.messages)
      },
    }
  }
}

function registerCTFRuntimeServices(container: Container, rootDir: string) {
  container.registerSingleton(queueToken, () => new QueueService())
  container.registerSingleton(modelPoolToken, (currentContainer) => {
    const logger = currentContainer.resolve(loggerToken).child({ component: "WorkspaceModelPool" })
    return new WorkspaceModelPool({
      rootDir,
      logger,
      providers: currentContainer.resolve(providerRegistryToken),
    })
  })
  container.registerSingleton(solverWorkspaceServiceToken, (currentContainer) => {
    const logger = currentContainer
      .resolve(loggerToken)
      .child({ component: "SolverWorkspaceService" })

    return new SolverWorkspaceService({
      rootDir,
      logger,
      providers: currentContainer.resolve(providerRegistryToken),
    })
  })

  container.registerSingleton(solverHubToken, (currentContainer) => {
    const logger = currentContainer.resolve(loggerToken).child({ component: "SolverHub" })

    return new SolverHub({
      logger,
      queue: currentContainer.resolve(queueToken),
      solverWorkspaces: currentContainer.resolve(solverWorkspaceServiceToken),
      modelPool: currentContainer.resolve(modelPoolToken),
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

export type {
  RuntimeCronOptions,
  RuntimeInitOptions,
  ModelPoolItem,
  ModelPoolStateSnapshot,
  ModelPoolCatalogProvider,
}

function resolveEnvPlaceholders(value: unknown): unknown {
  if (typeof value === "string" && value.startsWith("$env:")) {
    const envVar = value.slice(5)
    const envValue = process.env[envVar]
    if (!envValue) {
      throw new Error(`Missing environment variable referenced in config: ${envVar}`)
    }
    return envValue
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveEnvPlaceholders(item))
  }

  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value)) {
      output[key] = resolveEnvPlaceholders(nested)
    }
    return output
  }

  return value
}
