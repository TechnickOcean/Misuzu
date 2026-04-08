import { randomUUID } from "node:crypto"
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  DEFAULT_SOLVER_PROMPT_TEMPLATE,
  createCTFRuntimeWorkspaceWithoutPersistence,
  createSolverWorkspace,
  findBuiltinPlugin,
  resolveBuiltinPluginEntryPath,
  loadBuiltinPluginCatalog,
  type CTFRuntimeWorkspace,
  type EnvironmentAgent,
  type RuntimeInitOptions,
  type SolverAgent,
  type SolverWorkspace,
} from "misuzu-core"
import type {
  AgentStateSnapshot,
  ChallengeSummaryView,
  ProviderCatalogItem,
  ProviderConfigEntry,
  PluginCatalogItem,
  PluginReadmeResponse,
  PromptMode,
  RuntimeAgentWriteupResponse,
  RuntimeMarkSolvedRequest,
  RuntimeConfigUpdateRequest,
  RuntimeCreateRequest,
  RuntimePlatformConfig,
  RuntimeWriteupExportResponse,
  RuntimeWorkspaceSettingsSnapshot,
  RuntimeWorkspaceSnapshot,
  SolverCreateRequest,
  SolverWorkspaceSnapshot,
  WorkspaceDeleteRequest,
  WorkspaceRegistryEntry,
  WsServerMessage,
} from "../../shared/protocol.ts"
import { extractMessageParts, renderMessagePartsAsText } from "./agent-message-parts.ts"
import { EventBus } from "./event-bus.ts"
import { WorkspaceRegistryStore } from "./workspace-registry-store.ts"

const APP_ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const DEFAULT_WORKSPACE_ROOT = resolve(APP_ROOT_DIR, ".misuzu-web", "workspaces")

interface RuntimeWorkspaceSession {
  id: string
  workspace: CTFRuntimeWorkspace
  entry: WorkspaceRegistryEntry
  runtimeInitialized: boolean
  solverWriteups: Set<string>
  lastWriteupScanAt?: number
  environmentAgent?: EnvironmentAgent
  environmentUnsubscribe?: () => void
  solverUnsubscribers: Map<string, () => void>
}

interface SolverWorkspaceSession {
  id: string
  workspace: SolverWorkspace
  entry: WorkspaceRegistryEntry
  mainAgentUnsubscribe?: () => void
}

type RuntimePlatformPluginConfigInput = Omit<
  RuntimePlatformConfig["pluginConfig"],
  "maxConcurrentContainers"
> & {
  maxConcurrentContainers?: number
}

export class WorkspaceManager {
  private readonly runtimeSessions = new Map<string, RuntimeWorkspaceSession>()
  private readonly solverSessions = new Map<string, SolverWorkspaceSession>()

  constructor(
    private readonly registry: WorkspaceRegistryStore,
    private readonly events: EventBus,
  ) {}

  async initialize() {
    await this.registry.initialize()
  }

  listRegistryEntries() {
    return this.registry.listEntries().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async deleteWorkspace(workspaceId: string, request: WorkspaceDeleteRequest = {}) {
    const entry = this.registry.getEntry(workspaceId)
    if (!entry) {
      throw new Error(`Workspace not found: ${workspaceId}`)
    }

    if (entry.kind === "ctf-runtime") {
      await this.disposeRuntimeSession(workspaceId)
    } else {
      await this.disposeSolverSession(workspaceId)
    }

    if (request.deleteFiles) {
      await rm(entry.rootDir, { recursive: true, force: true })
    }

    const removed = await this.registry.removeEntry(workspaceId)
    if (!removed) {
      throw new Error(`Workspace not found in registry: ${workspaceId}`)
    }

    this.publishRegistryUpdate()
    return true
  }

  listPlugins(query?: string): PluginCatalogItem[] {
    const normalizedQuery = query?.trim().toLowerCase()

    return loadBuiltinPluginCatalog()
      .filter((plugin) => {
        if (!normalizedQuery) {
          return true
        }

        return [plugin.id, plugin.name, plugin.description]
          .filter((value): value is string => typeof value === "string")
          .some((value) => value.toLowerCase().includes(normalizedQuery))
      })
      .map((plugin) => ({
        id: plugin.id,
        name: plugin.name,
        description: plugin.description,
      }))
  }

  async listProviderCatalog(workspaceId?: string): Promise<ProviderCatalogItem[]> {
    if (!workspaceId) {
      return listBuiltinProviderCatalog()
    }

    const session = await this.requireRuntimeSession(workspaceId)
    return toProviderCatalog(session.workspace.listModelPoolCatalog())
  }

  async getPluginReadme(pluginId: string): Promise<PluginReadmeResponse> {
    const entry = findBuiltinPlugin(pluginId)
    if (!entry) {
      throw new Error(`Plugin not found: ${pluginId}`)
    }

    const readmePath = join(dirname(resolveBuiltinPluginEntryPath(entry)), "README.md")

    try {
      const markdown = await readFile(readmePath, "utf-8")
      return { id: pluginId, markdown }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error
      }

      return {
        id: pluginId,
        markdown: `# ${entry.name}\n\nNo README.md found for this plugin yet.`,
      }
    }
  }

  async createRuntimeWorkspace(request: RuntimeCreateRequest) {
    const id = request.id?.trim() || randomUUID()
    const rootDir = await this.resolveWorkspaceRootDir(id, "ctf-runtime", request.rootDir)
    const now = new Date().toISOString()

    const entry: WorkspaceRegistryEntry = {
      id,
      kind: "ctf-runtime",
      name: request.name?.trim() || `Runtime ${id.slice(0, 8)}`,
      rootDir,
      createdAt: now,
      updatedAt: now,
      runtime: {
        initialized: false,
      },
    }

    const session = await this.createRuntimeSession(entry)

    if (request.providerConfig) {
      await this.writeProviderConfig(session.workspace.providerConfigPath, request.providerConfig)
      session.workspace.reloadProviderConfig()
    }

    await this.applyModelPool(session.workspace, request.modelPool)

    if (request.pluginId) {
      await this.initializeRuntimeInternal(session, {
        pluginId: request.pluginId,
        pluginConfig: request.pluginConfig,
        solverPromptTemplate: request.solverPromptTemplate,
      })
    }

    if (request.createEnvironmentAgent || !request.pluginId) {
      this.ensureEnvironmentAgent(session)
    }

    this.persistRuntimeEntry(session)
    await this.registry.upsertEntry(session.entry)
    this.publishRegistryUpdate()
    this.publishRuntimeSnapshot(session)

    return this.toRuntimeSnapshot(session)
  }

  async initializeRuntime(
    workspaceId: string,
    options: { pluginId: string; pluginConfig?: unknown },
  ) {
    const session = await this.requireRuntimeSession(workspaceId)
    await this.initializeRuntimeInternal(session, options)
    this.persistRuntimeEntry(session)
    await this.registry.upsertEntry(session.entry)

    this.publishRegistryUpdate()
    this.publishRuntimeSnapshot(session)

    return this.toRuntimeSnapshot(session)
  }

  async setRuntimeDispatch(workspaceId: string, paused: boolean, autoEnqueue: boolean) {
    const session = await this.requireRuntimeSession(workspaceId)
    if (paused) {
      session.workspace.setAutoDispatchManaged(false)
      session.workspace.pauseTaskDispatch()
    } else {
      session.workspace.setAutoDispatchManaged(Boolean(autoEnqueue))
      session.workspace.resumeTaskDispatch()
      if (session.workspace.isAutoDispatchManaged()) {
        session.workspace.scheduleAutoDispatchRebalance(true)
      }
    }

    this.publishRuntimeSnapshot(session)
    return this.toRuntimeSnapshot(session)
  }

  async updateRuntimeModelPool(workspaceId: string, pool: RuntimeCreateRequest["modelPool"]) {
    const session = await this.requireRuntimeSession(workspaceId)
    if (!session.workspace.isTaskDispatchPaused()) {
      throw new Error("Pause runtime dispatch before updating model pool")
    }

    await this.applyModelPool(session.workspace, pool)
    this.publishRuntimeSnapshot(session)
    return this.toRuntimeSnapshot(session)
  }

  async syncRuntimeChallenges(workspaceId: string) {
    const session = await this.requireRuntimeSession(workspaceId)
    this.ensureRuntimeInitialized(session)
    await session.workspace.syncChallengesOnce()
    this.bindRuntimeSolverAgents(session)
    await this.refreshRuntimeWriteupPresence(session, true)

    if (session.workspace.isAutoDispatchManaged()) {
      session.workspace.scheduleAutoDispatchRebalance(true)
    }

    this.publishRuntimeSnapshot(session)
    return this.toRuntimeSnapshot(session)
  }

  async syncRuntimeNotices(workspaceId: string) {
    const session = await this.requireRuntimeSession(workspaceId)
    this.ensureRuntimeInitialized(session)
    await session.workspace.syncNoticesOnce()
    this.publishRuntimeSnapshot(session)
    return this.toRuntimeSnapshot(session)
  }

  async exportRuntimeWriteups(workspaceId: string): Promise<RuntimeWriteupExportResponse> {
    const session = await this.requireRuntimeSession(workspaceId)
    await this.refreshRuntimeWriteupPresence(session, true)
    const snapshot = this.toRuntimeSnapshot(session)
    const sections = await this.collectRuntimeWriteupSections(session, snapshot.challenges)
    const matchedSolvers = new Set(
      sections.filter((section) => section.challenge).map((section) => section.solverId),
    )
    const missing = snapshot.challenges.filter(
      (challenge) => !matchedSolvers.has(challenge.solverId),
    )

    const generatedAt = new Date().toISOString()
    return {
      workspaceId: session.id,
      fileName: buildRuntimeWriteupFileName(session.entry.name, generatedAt),
      markdown: buildRuntimeWriteupDocument({
        workspaceName: session.entry.name,
        workspaceId: session.id,
        generatedAt,
        challenges: snapshot.challenges,
        sections,
        missing,
      }),
      generatedAt,
      totalChallenges: snapshot.challenges.length,
      includedWriteups: sections.length,
    }
  }

  async enqueueRuntimeChallenge(workspaceId: string, challengeId: number) {
    const session = await this.requireRuntimeSession(workspaceId)
    this.ensureRuntimeInitialized(session)

    if (session.workspace.isChallengeManuallyBlocked(challengeId)) {
      throw new Error(`Challenge #${String(challengeId)} is manually blocked`)
    }

    void session.workspace.enqueueTask({ challenge: challengeId }).catch(() => {})

    if (session.workspace.isAutoDispatchManaged()) {
      session.workspace.scheduleAutoDispatchRebalance(true)
    }

    this.publishRuntimeSnapshot(session)
    return this.toRuntimeSnapshot(session)
  }

  async dequeueRuntimeChallenge(workspaceId: string, challengeId: number) {
    const session = await this.requireRuntimeSession(workspaceId)
    this.ensureRuntimeInitialized(session)

    const cancelledCount = this.cancelRuntimeChallengeTasks(session, challengeId)

    if (cancelledCount > 0 && session.workspace.isAutoDispatchManaged()) {
      session.workspace.scheduleAutoDispatchRebalance(true)
    }

    this.publishRuntimeSnapshot(session)
    return this.toRuntimeSnapshot(session)
  }

  async resetRuntimeSolver(workspaceId: string, challengeId: number) {
    const session = await this.requireRuntimeSession(workspaceId)
    this.ensureRuntimeInitialized(session)

    this.cancelRuntimeChallengeTasks(session, challengeId)

    const workspaceWithReset = session.workspace as {
      resetChallengeSolver?: (nextChallengeId: number) => boolean
    }

    if (typeof workspaceWithReset.resetChallengeSolver === "function") {
      if (!workspaceWithReset.resetChallengeSolver(challengeId)) {
        throw new Error(`Challenge solver not found: ${String(challengeId)}`)
      }
    } else {
      const challenge = this.toRuntimeSnapshot(session).challenges.find(
        (item) => item.challengeId === challengeId,
      )
      if (!challenge) {
        throw new Error(`Challenge solver not found: ${String(challengeId)}`)
      }

      session.workspace.getSolverById(challenge.solverId)?.abort()
      session.workspace.getSolverById(challenge.solverId)?.replaceMessages([])
    }

    if (session.workspace.isAutoDispatchManaged()) {
      session.workspace.scheduleAutoDispatchRebalance(true)
    }

    this.publishRuntimeSnapshot(session)
    return this.toRuntimeSnapshot(session)
  }

  async blockRuntimeSolver(workspaceId: string, challengeId: number) {
    const session = await this.requireRuntimeSession(workspaceId)
    this.ensureRuntimeInitialized(session)

    this.cancelRuntimeChallengeTasks(session, challengeId)
    if (!session.workspace.blockChallengeSolver(challengeId)) {
      throw new Error(`Challenge solver not found: ${String(challengeId)}`)
    }

    if (session.workspace.isAutoDispatchManaged()) {
      session.workspace.scheduleAutoDispatchRebalance(true)
    }

    this.publishRuntimeSnapshot(session)
    return this.toRuntimeSnapshot(session)
  }

  async unblockRuntimeSolver(workspaceId: string, challengeId: number) {
    const session = await this.requireRuntimeSession(workspaceId)
    this.ensureRuntimeInitialized(session)

    if (!session.workspace.unblockChallengeSolver(challengeId)) {
      throw new Error(`Challenge #${String(challengeId)} is not manually blocked`)
    }

    if (session.workspace.isAutoDispatchManaged()) {
      session.workspace.scheduleAutoDispatchRebalance(true)
    }

    this.publishRuntimeSnapshot(session)
    return this.toRuntimeSnapshot(session)
  }

  async markRuntimeSolverSolved(
    workspaceId: string,
    challengeId: RuntimeMarkSolvedRequest["challengeId"],
    writeupMarkdown: RuntimeMarkSolvedRequest["writeupMarkdown"],
  ) {
    const session = await this.requireRuntimeSession(workspaceId)
    this.ensureRuntimeInitialized(session)
    await this.refreshRuntimeWriteupPresence(session, true)

    const normalizedWriteup = normalizeWriteupContent(writeupMarkdown)

    const snapshotChallenge = this.toRuntimeSnapshot(session).challenges.find(
      (item) => item.challengeId === challengeId,
    )
    const progress = session.workspace
      .listSolverProgressStates()
      .find((state) => state.challengeId === challengeId)
    const solverId = snapshotChallenge?.solverId ?? progress?.solverId
    if (!solverId) {
      throw new Error(`Challenge solver not found: ${String(challengeId)}`)
    }

    const hasExistingWriteup = session.solverWriteups.has(solverId)
    if (!normalizedWriteup && !hasExistingWriteup) {
      throw new Error("WriteUp.md not found, please upload markdown before marking solved")
    }

    this.cancelRuntimeChallengeTasks(session, challengeId)

    if (normalizedWriteup) {
      const solverWorkspace = await session.workspace.deriveSolverWorkspace(solverId)
      await writeFile(
        join(solverWorkspace.rootDir, "WriteUp.md"),
        `${normalizedWriteup}\n`,
        "utf-8",
      )
      session.solverWriteups.add(solverId)
      session.lastWriteupScanAt = Date.now()
    }

    const workspaceWithMarkSolved = session.workspace as {
      markChallengeSolved?: (nextChallengeId: number) => boolean
    }

    if (
      typeof workspaceWithMarkSolved.markChallengeSolved !== "function" ||
      !workspaceWithMarkSolved.markChallengeSolved(challengeId)
    ) {
      throw new Error(`Challenge solver not found: ${String(challengeId)}`)
    }

    if (session.workspace.isAutoDispatchManaged()) {
      session.workspace.scheduleAutoDispatchRebalance(true)
    }

    this.publishRuntimeSnapshot(session)
    return this.toRuntimeSnapshot(session)
  }

  async getRuntimeSettings(workspaceId: string): Promise<RuntimeWorkspaceSettingsSnapshot> {
    const session = await this.requireRuntimeSession(workspaceId)
    const platformConfig =
      this.toRuntimePlatformConfig(
        await session.workspace.loadRuntimeOptionsFromPlatformConfig(),
      ) ?? this.resolveRuntimePlatformConfig(session)

    return {
      defaultSolverPromptTemplate: DEFAULT_SOLVER_PROMPT_TEMPLATE,
      providerConfig: await this.readProviderConfig(session.workspace.providerConfigPath),
      platformConfig,
      providerCatalog: toProviderCatalog(session.workspace.listModelPoolCatalog()),
    }
  }

  async updateRuntimeProviderConfig(workspaceId: string, providerConfig: ProviderConfigEntry[]) {
    const session = await this.requireRuntimeSession(workspaceId)

    await this.writeProviderConfig(session.workspace.providerConfigPath, providerConfig)
    session.workspace.reloadProviderConfig()

    this.publishRuntimeSnapshot(session)
    return this.toRuntimeSnapshot(session)
  }

  async updateRuntimeConfig(workspaceId: string, request: RuntimeConfigUpdateRequest) {
    const session = await this.requireRuntimeSession(workspaceId)

    if (request.platformConfig) {
      const normalizedPlatformConfig = this.normalizeRuntimePlatformConfig(request.platformConfig)
      await this.writeRuntimePlatformConfig(
        session.workspace.platformConfigPath,
        normalizedPlatformConfig,
      )
    }

    this.publishRuntimeSnapshot(session)
    return this.toRuntimeSnapshot(session)
  }

  async getRuntimeSnapshot(workspaceId: string) {
    const session = await this.requireRuntimeSession(workspaceId)
    this.bindRuntimeSolverAgents(session)
    await this.refreshRuntimeWriteupPresence(session)
    return this.toRuntimeSnapshot(session)
  }

  async ensureRuntimeEnvironmentAgent(workspaceId: string) {
    const session = await this.requireRuntimeSession(workspaceId)
    this.ensureEnvironmentAgent(session)
    this.publishRuntimeSnapshot(session)
    return this.toRuntimeSnapshot(session)
  }

  async getRuntimeAgentState(workspaceId: string, agentId: string) {
    const session = await this.requireRuntimeSession(workspaceId)
    const agent = await this.resolveRuntimeAgent(session, agentId)
    return this.toAgentSnapshot(agent, agentId)
  }

  async getRuntimeAgentWriteup(
    workspaceId: string,
    agentId: string,
  ): Promise<RuntimeAgentWriteupResponse> {
    const session = await this.requireRuntimeSession(workspaceId)
    await this.refreshRuntimeWriteupPresence(session)
    const challenge = this.toRuntimeSnapshot(session).challenges.find(
      (item) => item.solverId === agentId,
    )

    if (agentId === "environment") {
      return {
        workspaceId,
        agentId,
        challengeId: challenge?.challengeId,
        challengeTitle: challenge?.title,
        exists: false,
        markdown: "",
      }
    }

    const writeupPath = join(session.workspace.rootDir, "solvers", agentId, "WriteUp.md")

    try {
      const markdown = normalizeWriteupContent(await readFile(writeupPath, "utf-8"))
      return {
        workspaceId,
        agentId,
        challengeId: challenge?.challengeId,
        challengeTitle: challenge?.title,
        exists: markdown.length > 0,
        markdown,
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return {
          workspaceId,
          agentId,
          challengeId: challenge?.challengeId,
          challengeTitle: challenge?.title,
          exists: false,
          markdown: "",
        }
      }

      throw error
    }
  }

  async promptRuntimeAgent(
    workspaceId: string,
    agentId: string,
    prompt: string,
    mode: PromptMode = "followup",
  ) {
    const session = await this.requireRuntimeSession(workspaceId)
    const agent = await this.resolveRuntimeAgent(session, agentId)

    const isRunning = isAgentRunning(agent)
    try {
      await applyPromptMode(agent, prompt, mode)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(
        `Failed to prompt runtime agent ${agentId} (mode=${mode}, running=${String(isRunning)}): ${reason}`,
      )
    }
    this.publishRuntimeSnapshot(session)

    return this.toAgentSnapshot(agent, agentId)
  }

  async createSolverWorkspace(request: SolverCreateRequest) {
    const id = request.id?.trim() || randomUUID()
    const rootDir = await this.resolveWorkspaceRootDir(id, "solver", request.rootDir)
    const now = new Date().toISOString()

    const entry: WorkspaceRegistryEntry = {
      id,
      kind: "solver",
      name: request.name?.trim() || `Solver ${id.slice(0, 8)}`,
      rootDir,
      createdAt: now,
      updatedAt: now,
    }

    if (request.providerConfig) {
      await this.writeProviderConfig(
        resolve(rootDir, ".misuzu", "providers.json"),
        request.providerConfig,
      )
    }

    const workspace = await createSolverWorkspace({ rootDir })
    workspace.bootstrap()
    const session: SolverWorkspaceSession = {
      id,
      workspace,
      entry,
    }

    this.solverSessions.set(id, session)
    this.bindSolverMainAgent(session)

    if (!workspace.mainAgent && request.model) {
      const model = workspace.getModel(request.model.provider, request.model.modelId)
      if (!model) {
        throw new Error(
          `Model not found: ${request.model.provider}/${request.model.modelId}. Check providers.json mappings.`,
        )
      }

      await workspace.createMainAgent({
        initialState: {
          model,
          systemPrompt: request.systemPrompt,
        },
      })
      this.bindSolverMainAgent(session)
    }

    await this.registry.upsertEntry(entry)
    this.publishRegistryUpdate()
    this.publishSolverSnapshot(session)

    return this.toSolverSnapshot(session)
  }

  async getSolverSnapshot(workspaceId: string) {
    const session = await this.requireSolverSession(workspaceId)
    this.bindSolverMainAgent(session)
    return this.toSolverSnapshot(session)
  }

  async getSolverAgentState(workspaceId: string) {
    const session = await this.requireSolverSession(workspaceId)
    const agent = session.workspace.mainAgent
    if (!agent) {
      throw new Error("Solver workspace has no main agent yet")
    }

    return this.toAgentSnapshot(agent, "main")
  }

  async promptSolver(workspaceId: string, prompt: string, mode: PromptMode = "followup") {
    const session = await this.requireSolverSession(workspaceId)
    const agent = session.workspace.mainAgent
    if (!agent) {
      throw new Error("Solver workspace has no main agent yet")
    }

    const isRunning = isAgentRunning(agent)
    try {
      await applyPromptMode(agent, prompt, mode)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(
        `Failed to prompt solver agent (mode=${mode}, running=${String(isRunning)}): ${reason}`,
      )
    }
    this.publishSolverSnapshot(session)

    return this.toAgentSnapshot(agent, "main")
  }

  private async createRuntimeSession(entry: WorkspaceRegistryEntry) {
    const workspace = createCTFRuntimeWorkspaceWithoutPersistence({ rootDir: entry.rootDir })
    await workspace.initPersistence()
    workspace.bootstrapProviders()

    const persistedRuntime =
      workspace.getPersistedRuntimeOptions() ??
      (await workspace.loadRuntimeOptionsFromPlatformConfig())

    let runtimeInitialized = false
    if (persistedRuntime) {
      await workspace.initializeRuntime({
        ...persistedRuntime,
        startPaused: true,
      })
      runtimeInitialized = true
    }

    workspace.pauseTaskDispatch()

    const session: RuntimeWorkspaceSession = {
      id: entry.id,
      workspace,
      entry,
      runtimeInitialized,
      solverWriteups: new Set(),
      solverUnsubscribers: new Map(),
    }

    this.runtimeSessions.set(entry.id, session)
    session.workspace.setRuntimeStateChangeListener(() => {
      const activeSession = this.runtimeSessions.get(entry.id)
      if (!activeSession) {
        return
      }

      this.publishRuntimeSnapshot(activeSession)
    })
    this.bindRuntimeSolverAgents(session)
    session.workspace.setAutoDispatchManaged(false)
    await this.refreshRuntimeWriteupPresence(session, true)

    return session
  }

  private async disposeRuntimeSession(workspaceId: string) {
    const session = this.runtimeSessions.get(workspaceId)
    if (!session) {
      return
    }

    session.environmentUnsubscribe?.()
    session.environmentUnsubscribe = undefined
    for (const unsubscribe of session.solverUnsubscribers.values()) {
      unsubscribe()
    }
    session.solverUnsubscribers.clear()

    this.runtimeSessions.delete(workspaceId)
    await session.workspace.shutdown()
  }

  private async disposeSolverSession(workspaceId: string) {
    const session = this.solverSessions.get(workspaceId)
    if (!session) {
      return
    }

    session.mainAgentUnsubscribe?.()
    session.mainAgentUnsubscribe = undefined

    this.solverSessions.delete(workspaceId)
    await session.workspace.shutdown()
  }

  private async requireRuntimeSession(workspaceId: string) {
    const existing = this.runtimeSessions.get(workspaceId)
    if (existing) {
      return existing
    }

    const entry = this.registry.getEntry(workspaceId)
    if (!entry || entry.kind !== "ctf-runtime") {
      throw new Error(`Runtime workspace not found: ${workspaceId}`)
    }

    return this.createRuntimeSession(entry)
  }

  private async requireSolverSession(workspaceId: string) {
    const existing = this.solverSessions.get(workspaceId)
    if (existing) {
      return existing
    }

    const entry = this.registry.getEntry(workspaceId)
    if (!entry || entry.kind !== "solver") {
      throw new Error(`Solver workspace not found: ${workspaceId}`)
    }

    const workspace = await createSolverWorkspace({ rootDir: entry.rootDir })
    workspace.bootstrap()
    const session: SolverWorkspaceSession = {
      id: entry.id,
      workspace,
      entry,
    }

    this.solverSessions.set(entry.id, session)
    this.bindSolverMainAgent(session)

    return session
  }

  private async initializeRuntimeInternal(
    session: RuntimeWorkspaceSession,
    options: { pluginId: string; pluginConfig?: unknown; solverPromptTemplate?: string },
  ) {
    if (!options.pluginConfig || typeof options.pluginConfig !== "object") {
      throw new Error("pluginConfig is required for runtime initialization")
    }

    const runtimeOptions: RuntimeInitOptions = {
      pluginId: options.pluginId,
      pluginConfig: options.pluginConfig as RuntimeInitOptions["pluginConfig"],
      solverPromptTemplate: this.normalizeSolverPromptTemplate(options.solverPromptTemplate),
      startPaused: true,
    }

    await session.workspace.initializeRuntime(runtimeOptions)
    session.workspace.pauseTaskDispatch()
    session.workspace.setAutoDispatchManaged(false)
    session.runtimeInitialized = true
    session.entry = {
      ...session.entry,
      runtime: {
        initialized: true,
        pluginId: options.pluginId,
      },
    }
    this.bindRuntimeSolverAgents(session)
    await this.refreshRuntimeWriteupPresence(session, true)
  }

  private ensureRuntimeInitialized(session: RuntimeWorkspaceSession) {
    if (!session.runtimeInitialized) {
      throw new Error("Runtime workspace is not initialized with a platform plugin yet")
    }
  }

  private ensureEnvironmentAgent(session: RuntimeWorkspaceSession) {
    if (session.environmentAgent) {
      return session.environmentAgent
    }

    const environmentAgent = session.workspace.createEnvironmentAgent()
    session.environmentAgent = environmentAgent
    session.environmentUnsubscribe?.()
    session.environmentUnsubscribe = environmentAgent.subscribe((event) => {
      this.publishWs(`runtime:${session.id}`, {
        type: "agent.event",
        payload: {
          workspaceId: session.id,
          agentId: "environment",
          source: "runtime",
          event,
        },
      })

      if (event.type === "message_end" || event.type === "agent_end") {
        this.publishRuntimeSnapshot(session)
      }
    })

    return environmentAgent
  }

  private bindRuntimeSolverAgents(session: RuntimeWorkspaceSession) {
    const challenges = session.workspace.listManagedChallenges()
    const activeSolverIds = new Set(challenges.map((challenge) => challenge.solverId))

    for (const challenge of challenges) {
      if (session.solverUnsubscribers.has(challenge.solverId)) {
        continue
      }

      const solver = session.workspace.getSolverById(challenge.solverId)
      if (!solver) {
        continue
      }

      const unsubscribe = solver.subscribe((event) => {
        this.publishWs(`runtime:${session.id}`, {
          type: "agent.event",
          payload: {
            workspaceId: session.id,
            agentId: challenge.solverId,
            source: "runtime",
            event,
          },
        })

        if (event.type === "message_end" || event.type === "agent_end") {
          this.publishRuntimeSnapshot(session)
        }
      })

      session.solverUnsubscribers.set(challenge.solverId, unsubscribe)
    }

    for (const [solverId, unsubscribe] of session.solverUnsubscribers.entries()) {
      if (activeSolverIds.has(solverId)) {
        continue
      }

      unsubscribe()
      session.solverUnsubscribers.delete(solverId)
    }
  }

  private bindSolverMainAgent(session: SolverWorkspaceSession) {
    const mainAgent = session.workspace.mainAgent
    if (!mainAgent || session.mainAgentUnsubscribe) {
      return
    }

    session.mainAgentUnsubscribe = mainAgent.subscribe((event) => {
      this.publishWs(`solver:${session.id}`, {
        type: "agent.event",
        payload: {
          workspaceId: session.id,
          agentId: "main",
          source: "solver",
          event,
        },
      })

      if (event.type === "message_end" || event.type === "agent_end") {
        this.publishSolverSnapshot(session)
      }
    })
  }

  private async resolveRuntimeAgent(session: RuntimeWorkspaceSession, agentId: string) {
    if (agentId === "environment") {
      return this.ensureEnvironmentAgent(session)
    }

    const solver = session.workspace.getSolverById(agentId)
    if (solver) {
      return solver
    }

    // Fallback to persisted solver workspace so solved/detached solvers can still expose history.
    const solverWorkspace = await session.workspace.deriveSolverWorkspace(agentId)
    if (solverWorkspace.mainAgent) {
      return solverWorkspace.mainAgent
    }

    throw new Error(`Runtime agent not found: ${agentId}`)
  }

  private toRuntimeSnapshot(session: RuntimeWorkspaceSession): RuntimeWorkspaceSnapshot {
    const rankEntries = (
      session.workspace as {
        listChallengeRanks?: () => Array<{ challengeId: number; rank: number }>
      }
    ).listChallengeRanks?.()

    const rankByChallengeId = new Map<number, number>(
      (rankEntries ?? []).map((entry) => [entry.challengeId, entry.rank] as const),
    )

    const activationByChallengeId = new Map<number, ChallengeSummaryView>()
    for (const activation of session.workspace.listSolverActivationStates()) {
      const status =
        activation.status === "active"
          ? "active"
          : activation.status === "model_unassigned"
            ? "model_unassigned"
            : "idle"

      activationByChallengeId.set(activation.challengeId, {
        challengeId: activation.challengeId,
        solverId: activation.solverId,
        title: String(activation.challengeId),
        category: "unknown",
        score: 0,
        solvedCount: 0,
        status,
        hasWriteup: false,
        canMarkSolved: false,
        activeTaskId: activation.activeTaskId,
        modelId: activation.modelId,
        rank: rankByChallengeId.get(activation.challengeId),
      })
    }

    const progressByChallengeId = new Map(
      session.workspace
        .listSolverProgressStates()
        .map((state) => [state.challengeId, state] as const),
    )
    const queuedTaskByChallengeId = new Map<number, string>()
    for (const pendingTask of session.workspace.listPendingSchedulerTasks()) {
      const challengeId = resolveChallengeIdFromPayload(pendingTask.payload)
      if (challengeId === undefined || queuedTaskByChallengeId.has(challengeId)) {
        continue
      }

      queuedTaskByChallengeId.set(challengeId, pendingTask.taskId)
    }

    for (const challenge of session.workspace.listManagedChallenges()) {
      const existing = activationByChallengeId.get(challenge.challengeId)
      const progress = progressByChallengeId.get(challenge.challengeId)
      const queuedTaskId = queuedTaskByChallengeId.get(challenge.challengeId)

      const status = resolveChallengeStatus({
        activationStatus: existing?.status,
        progressStatus: progress?.status,
        queuedTaskId,
      })
      const manuallyBlocked = progress?.manualBlocked === true
      const hasWriteup =
        progress?.writeUpReady === true || session.solverWriteups.has(challenge.solverId)
      const canMarkSolved = hasWriteup && status !== "solved"

      activationByChallengeId.set(challenge.challengeId, {
        challengeId: challenge.challengeId,
        solverId: challenge.solverId,
        title: challenge.title,
        category: challenge.category,
        requiresContainer: challenge.requiresContainer,
        manuallyBlocked,
        hasWriteup,
        canMarkSolved,
        score: challenge.score,
        solvedCount: challenge.solvedCount,
        status,
        activeTaskId: existing?.activeTaskId,
        queuedTaskId,
        statusReason:
          status === "blocked"
            ? progress?.blockedReason
            : status === "model_unassigned"
              ? "Solver has no model assignment from model pool yet"
              : undefined,
        modelId: existing?.modelId,
        rank: manuallyBlocked ? 0 : rankByChallengeId.get(challenge.challengeId),
      })
    }

    const challenges = [...activationByChallengeId.values()].sort(
      (left, right) =>
        challengeStatusWeight(left.status) - challengeStatusWeight(right.status) ||
        (right.rank ?? Number.NEGATIVE_INFINITY) - (left.rank ?? Number.NEGATIVE_INFINITY) ||
        left.challengeId - right.challengeId,
    )

    const environmentAgentAdapted = isEnvironmentAgentAdapted(session.environmentAgent)
    const setupPhase = resolveRuntimeSetupPhase({
      initialized: session.runtimeInitialized,
      environmentAgentReady: Boolean(session.environmentAgent),
      environmentAgentAdapted,
    })

    const agents: RuntimeWorkspaceSnapshot["agents"] = []
    if (session.environmentAgent) {
      agents.push({
        id: "environment",
        name: "Environment Agent",
        role: "environment",
      })
    }

    for (const challenge of challenges) {
      if (!session.workspace.getSolverById(challenge.solverId)) {
        continue
      }

      agents.push({
        id: challenge.solverId,
        name: challenge.title,
        role: "solver",
        challengeId: challenge.challengeId,
      })
    }

    return {
      id: session.id,
      rootDir: session.workspace.rootDir,
      initialized: session.runtimeInitialized,
      setupPhase,
      pluginId: session.runtimeInitialized
        ? (session.workspace.getPersistedRuntimeOptions()?.pluginId ??
          session.entry.runtime?.pluginId)
        : session.entry.runtime?.pluginId,
      paused: session.workspace.isTaskDispatchPaused(),
      queue: session.workspace.getSchedulerState(),
      modelPool: session.workspace.getModelPoolState(),
      challenges,
      agents,
      environmentAgentReady: Boolean(session.environmentAgent),
      environmentAgentAdapted,
    }
  }

  private toSolverSnapshot(session: SolverWorkspaceSession): SolverWorkspaceSnapshot {
    const mainAgent = session.workspace.mainAgent
    const model = mainAgent?.state.model

    return {
      id: session.id,
      rootDir: session.workspace.rootDir,
      hasMainAgent: Boolean(mainAgent),
      modelId: model ? `${model.provider}/${model.id}` : undefined,
      messageCount: mainAgent?.state.messages.length ?? 0,
    }
  }

  private toAgentSnapshot(
    agent: EnvironmentAgent | SolverAgent,
    agentId?: string,
  ): AgentStateSnapshot {
    const model = agent.state.model
    return {
      agentId,
      modelId: model ? `${model.provider}/${model.id}` : undefined,
      thinkingLevel: agent.state.thinkingLevel,
      isRunning: isAgentRunning(agent),
      messages: agent.state.messages.map((message) => {
        const parts = extractMessageParts(message.content)
        return {
          role: message.role,
          text: renderMessagePartsAsText(parts),
          parts: parts.length > 0 ? parts : undefined,
          timestamp: message.timestamp,
        }
      }),
    }
  }

  private async applyModelPool(
    workspace: CTFRuntimeWorkspace,
    pool: RuntimeCreateRequest["modelPool"],
  ) {
    if (!pool.length) {
      throw new Error("modelPool must contain at least one item")
    }

    const items = pool.map((item) => ({
      provider: item.provider,
      modelId: item.modelId,
      maxConcurrency: item.maxConcurrency,
    }))

    await workspace.setModelPoolItems(items)
  }

  private async refreshRuntimeWriteupPresence(session: RuntimeWorkspaceSession, force = false) {
    const now = Date.now()
    if (!force && session.lastWriteupScanAt && now - session.lastWriteupScanAt < 2500) {
      return
    }

    const solverRootDir = join(session.workspace.rootDir, "solvers")
    const nextWriteups = new Set<string>()

    try {
      const entries = await readdir(solverRootDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue
        }

        const writeupPath = join(solverRootDir, entry.name, "WriteUp.md")
        try {
          const markdown = normalizeWriteupContent(await readFile(writeupPath, "utf-8"))
          if (markdown) {
            nextWriteups.add(entry.name)
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw error
          }
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error
      }
    }

    session.solverWriteups = nextWriteups
    session.lastWriteupScanAt = now
  }

  private async collectRuntimeWriteupSections(
    session: RuntimeWorkspaceSession,
    challenges: ChallengeSummaryView[],
  ): Promise<RuntimeWriteupSection[]> {
    const challengeBySolverId = new Map(
      challenges.map((challenge) => [challenge.solverId, challenge]),
    )
    const challengeByChallengeId = new Map(
      challenges.map((challenge) => [challenge.challengeId, challenge] as const),
    )
    const progressByChallengeId = new Map(
      session.workspace
        .listSolverProgressStates()
        .map((progress) => [progress.challengeId, progress] as const),
    )
    const sections: RuntimeWriteupSection[] = []

    for (const solverId of session.solverWriteups) {
      const writeupPath = join(session.workspace.rootDir, "solvers", solverId, "WriteUp.md")
      try {
        const markdown = normalizeWriteupContent(await readFile(writeupPath, "utf-8"))
        if (!markdown) {
          continue
        }

        let challenge = challengeBySolverId.get(solverId)
        if (!challenge) {
          const challengeId = resolveChallengeIdFromSolverId(solverId)
          if (challengeId !== undefined) {
            challenge = challengeByChallengeId.get(challengeId)
          }

          if (!challenge && challengeId !== undefined) {
            challenge = await this.resolveWriteupChallengeFromPlatform(
              session,
              challengeId,
              solverId,
              progressByChallengeId.get(challengeId),
            )
          }
        }

        sections.push({
          solverId,
          challenge,
          markdown,
        })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error
        }
      }
    }

    return sections.sort((left, right) => {
      if (left.challenge && right.challenge) {
        return left.challenge.challengeId - right.challenge.challengeId
      }

      if (left.challenge) {
        return -1
      }

      if (right.challenge) {
        return 1
      }

      return left.solverId.localeCompare(right.solverId)
    })
  }

  private async resolveWriteupChallengeFromPlatform(
    session: RuntimeWorkspaceSession,
    challengeId: number,
    solverId: string,
    progress?: {
      status: "idle" | "writeup_required" | "solved" | "blocked"
      blockedReason?: string
      manualBlocked: boolean
    },
  ): Promise<ChallengeSummaryView | undefined> {
    const workspaceWithChallengeDetail = session.workspace as {
      getChallengeDetail?: (nextChallengeId: number) => Promise<{
        title: string
        category: string
        score: number
        requiresContainer: boolean
      }>
    }
    if (typeof workspaceWithChallengeDetail.getChallengeDetail !== "function") {
      return undefined
    }

    try {
      const detail = await workspaceWithChallengeDetail.getChallengeDetail(challengeId)
      return {
        challengeId,
        solverId,
        title: detail.title,
        category: detail.category,
        requiresContainer: detail.requiresContainer,
        manuallyBlocked: progress?.manualBlocked,
        hasWriteup: true,
        canMarkSolved: false,
        score: detail.score,
        solvedCount: 0,
        status: resolveChallengeStatus({
          progressStatus: progress?.status,
        }),
        statusReason: progress?.blockedReason,
      }
    } catch {
      return undefined
    }
  }

  private cancelRuntimeChallengeTasks(session: RuntimeWorkspaceSession, challengeId: number) {
    let cancelledCount = 0

    const pending = session.workspace.listPendingSchedulerTasks()
    for (const task of pending) {
      if (resolveChallengeIdFromPayload(task.payload) !== challengeId) {
        continue
      }

      const cancelled = session.workspace.cancelSchedulerTask(task.taskId)
      if (cancelled) {
        cancelledCount += 1
      }
    }

    const inflight = session.workspace.listInflightSchedulerTasks()
    for (const task of inflight) {
      if (resolveChallengeIdFromPayload(task.task.payload) !== challengeId) {
        continue
      }

      const cancelled = session.workspace.cancelSchedulerTask(task.task.taskId)
      if (cancelled) {
        cancelledCount += 1
      }
    }

    return cancelledCount
  }

  private resolveRuntimePlatformConfig(
    session: RuntimeWorkspaceSession,
  ): RuntimePlatformConfig | undefined {
    return this.toRuntimePlatformConfig(session.workspace.getPersistedRuntimeOptions())
  }

  private toRuntimePlatformConfig(
    runtimeOptions:
      | {
          pluginId?: string
          pluginConfig?: RuntimePlatformPluginConfigInput
          solverPromptTemplate?: string
          cron?: RuntimePlatformConfig["cron"]
        }
      | undefined,
  ): RuntimePlatformConfig | undefined {
    if (!runtimeOptions?.pluginConfig) {
      return undefined
    }

    const pluginId = runtimeOptions.pluginId
    if (!pluginId) {
      return undefined
    }

    const maxConcurrentContainers = runtimeOptions.pluginConfig.maxConcurrentContainers
    const normalizedMaxConcurrentContainers =
      typeof maxConcurrentContainers === "number" && Number.isFinite(maxConcurrentContainers)
        ? Math.max(1, Math.floor(maxConcurrentContainers))
        : 1
    const solverPromptTemplate = this.normalizeSolverPromptTemplate(
      runtimeOptions.solverPromptTemplate,
    )

    return {
      pluginId,
      pluginConfig: {
        ...runtimeOptions.pluginConfig,
        maxConcurrentContainers: normalizedMaxConcurrentContainers,
      },
      solverPromptTemplate: solverPromptTemplate ?? DEFAULT_SOLVER_PROMPT_TEMPLATE,
      cron: runtimeOptions.cron,
    }
  }

  private normalizeRuntimePlatformConfig(
    platformConfig: RuntimePlatformConfig,
  ): RuntimePlatformConfig {
    const normalizedPluginId = platformConfig.pluginId.trim()
    if (!normalizedPluginId) {
      throw new Error("pluginId is required for runtime config")
    }

    return {
      ...platformConfig,
      pluginId: normalizedPluginId,
      solverPromptTemplate: this.normalizeSolverPromptTemplate(platformConfig.solverPromptTemplate),
    }
  }

  private normalizeSolverPromptTemplate(template: string | undefined) {
    const normalized = template?.trim()
    if (!normalized || normalized === DEFAULT_SOLVER_PROMPT_TEMPLATE) {
      return undefined
    }

    return normalized
  }

  private async readProviderConfig(providerConfigPath: string): Promise<ProviderConfigEntry[]> {
    try {
      const raw = await readFile(providerConfigPath, "utf-8")
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) {
        return []
      }

      return parsed
        .filter((item): item is ProviderConfigEntry => {
          if (!item || typeof item !== "object") {
            return false
          }

          const provider = (item as { provider?: unknown }).provider
          return typeof provider === "string" && provider.trim().length > 0
        })
        .map((item) => ({
          provider: item.provider.trim(),
          baseProvider:
            typeof item.baseProvider === "string" && item.baseProvider.trim().length > 0
              ? item.baseProvider.trim()
              : undefined,
          baseUrl: typeof item.baseUrl === "string" ? item.baseUrl : undefined,
          apiKeyEnvVar:
            typeof item.apiKeyEnvVar === "string" && item.apiKeyEnvVar.trim().length > 0
              ? item.apiKeyEnvVar.trim()
              : undefined,
          api_key:
            typeof item.api_key === "string" && item.api_key.trim().length > 0
              ? item.api_key.trim()
              : undefined,
          modelIds: Array.isArray(item.modelIds)
            ? item.modelIds.filter((value): value is string => typeof value === "string")
            : undefined,
          modelMappings: Array.isArray(item.modelMappings)
            ? item.modelMappings.filter(
                (mapping): mapping is NonNullable<ProviderConfigEntry["modelMappings"]>[number] =>
                  typeof mapping === "string" || (Boolean(mapping) && typeof mapping === "object"),
              )
            : undefined,
        }))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return []
      }

      throw error
    }
  }

  private async writeProviderConfig(providerConfigPath: string, entries: ProviderConfigEntry[]) {
    const normalizedEntries = entries
      .filter((entry) => typeof entry.provider === "string" && entry.provider.trim().length > 0)
      .map((entry) => ({
        provider: entry.provider.trim(),
        baseProvider:
          typeof entry.baseProvider === "string" && entry.baseProvider.trim().length > 0
            ? entry.baseProvider.trim()
            : undefined,
        baseUrl: typeof entry.baseUrl === "string" ? entry.baseUrl : undefined,
        apiKeyEnvVar:
          typeof entry.apiKeyEnvVar === "string" && entry.apiKeyEnvVar.trim().length > 0
            ? entry.apiKeyEnvVar.trim()
            : undefined,
        api_key:
          typeof entry.api_key === "string" && entry.api_key.trim().length > 0
            ? entry.api_key.trim()
            : undefined,
        modelIds:
          Array.isArray(entry.modelIds) && entry.modelIds.length > 0
            ? entry.modelIds
                .map((value) => (typeof value === "string" ? value.trim() : ""))
                .filter((value) => value.length > 0)
            : undefined,
        modelMappings:
          Array.isArray(entry.modelMappings) && entry.modelMappings.length > 0
            ? entry.modelMappings
                .map((mapping) => {
                  if (typeof mapping === "string") {
                    const sourceModelId = mapping.trim()
                    return sourceModelId.length > 0 ? sourceModelId : undefined
                  }

                  if (!mapping || typeof mapping !== "object") {
                    return undefined
                  }

                  const sourceModelId =
                    typeof mapping.sourceModelId === "string" ? mapping.sourceModelId.trim() : ""
                  if (!sourceModelId) {
                    return undefined
                  }

                  const targetModelId =
                    typeof mapping.targetModelId === "string" &&
                    mapping.targetModelId.trim().length > 0
                      ? mapping.targetModelId.trim()
                      : undefined
                  const targetModelName =
                    typeof mapping.targetModelName === "string" &&
                    mapping.targetModelName.trim().length > 0
                      ? mapping.targetModelName.trim()
                      : undefined

                  return {
                    sourceModelId,
                    targetModelId,
                    targetModelName,
                  }
                })
                .filter(
                  (mapping): mapping is Exclude<typeof mapping, undefined> => mapping !== undefined,
                )
            : undefined,
      }))
      .map((entry) => {
        if (!entry.baseProvider) {
          return {
            provider: entry.provider,
            apiKeyEnvVar: entry.apiKeyEnvVar,
            api_key: entry.api_key,
          }
        }

        return {
          provider: entry.provider,
          baseProvider: entry.baseProvider,
          baseUrl: entry.baseUrl,
          apiKeyEnvVar: entry.apiKeyEnvVar,
          api_key: entry.api_key,
          modelIds: entry.modelIds,
          modelMappings: entry.modelMappings,
        }
      })

    await mkdir(dirname(providerConfigPath), { recursive: true })
    await writeFile(providerConfigPath, `${JSON.stringify(normalizedEntries, null, 2)}\n`, "utf-8")
  }

  private async writeRuntimePlatformConfig(
    platformConfigPath: string,
    platformConfig: RuntimePlatformConfig,
  ) {
    await mkdir(dirname(platformConfigPath), { recursive: true })
    await writeFile(platformConfigPath, `${JSON.stringify(platformConfig, null, 2)}\n`, "utf-8")
  }

  private persistRuntimeEntry(session: RuntimeWorkspaceSession) {
    const runtimeOptions = session.workspace.getPersistedRuntimeOptions()
    const now = new Date().toISOString()
    session.entry = {
      ...session.entry,
      updatedAt: now,
      runtime: {
        initialized: session.runtimeInitialized,
        pluginId: runtimeOptions?.pluginId ?? session.entry.runtime?.pluginId,
      },
    }
  }

  private publishRuntimeSnapshot(session: RuntimeWorkspaceSession) {
    this.bindRuntimeSolverAgents(session)
    this.publishWs(`runtime:${session.id}`, {
      type: "runtime.snapshot",
      payload: {
        workspaceId: session.id,
        snapshot: this.toRuntimeSnapshot(session),
      },
    })
  }

  private publishSolverSnapshot(session: SolverWorkspaceSession) {
    this.publishWs(`solver:${session.id}`, {
      type: "solver.snapshot",
      payload: {
        workspaceId: session.id,
        snapshot: this.toSolverSnapshot(session),
      },
    })
  }

  private publishRegistryUpdate() {
    this.publishWs("registry", {
      type: "registry.updated",
      payload: {
        entries: this.listRegistryEntries(),
      },
    })
  }

  private publishWs(topic: string, message: WsServerMessage) {
    this.events.publish(topic, message)
  }

  private async resolveWorkspaceRootDir(
    id: string,
    kind: WorkspaceRegistryEntry["kind"],
    requestedRootDir?: string,
  ) {
    const rootDir = requestedRootDir?.trim()
      ? resolve(requestedRootDir)
      : resolve(DEFAULT_WORKSPACE_ROOT, kind, id)

    await mkdir(rootDir, { recursive: true })
    return rootDir
  }
}

interface RuntimeWriteupSection {
  solverId: string
  challenge?: ChallengeSummaryView
  markdown: string
}

function buildRuntimeWriteupFileName(workspaceName: string, generatedAt: string) {
  const normalizedWorkspace = sanitizeFileSegment(workspaceName)
  const datePart = generatedAt.slice(0, 10)
  return `${normalizedWorkspace}-dashboard-writeups-${datePart}.md`
}

function sanitizeFileSegment(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")

  return normalized || "workspace"
}

function buildRuntimeWriteupDocument(input: {
  workspaceName: string
  workspaceId: string
  generatedAt: string
  challenges: ChallengeSummaryView[]
  sections: RuntimeWriteupSection[]
  missing: ChallengeSummaryView[]
}) {
  const matchedSections = input.sections.filter((section) => section.challenge)
  const archivedSections = input.sections.filter((section) => !section.challenge)
  const solvedCount = input.challenges.filter((challenge) => challenge.status === "solved").length
  const blockedCount = input.challenges.filter((challenge) => challenge.status === "blocked").length
  const queuedCount = input.challenges.filter((challenge) => challenge.status === "queued").length
  const activeCount = input.challenges.filter((challenge) => challenge.status === "active").length
  const unresolvedCount = input.challenges.filter(
    (challenge) => challenge.status === "model_unassigned",
  ).length

  const lines: string[] = [
    `# ${input.workspaceName} Dashboard Writeups`,
    "",
    "## Overview",
    `- Workspace: ${input.workspaceName} (${input.workspaceId})`,
    `- Generated at: ${input.generatedAt}`,
    `- Challenges tracked: ${String(input.challenges.length)}`,
    `- Exported writeups: ${String(input.sections.length)} (matched ${String(matchedSections.length)}, archived ${String(archivedSections.length)})`,
    `- Missing tracked writeups: ${String(input.missing.length)}`,
    `- Status snapshot: solved ${String(solvedCount)}, blocked ${String(blockedCount)}, active ${String(activeCount)}, queued ${String(queuedCount)}, model_unassigned ${String(unresolvedCount)}`,
    "",
  ]

  if (matchedSections.length > 0 || archivedSections.length > 0) {
    lines.push("## Contents", "")
    if (matchedSections.length > 0) {
      lines.push("### Tracked Challenges", "")
    }
    for (const section of matchedSections) {
      lines.push(
        `- [#${String(section.challenge!.challengeId)} ${section.challenge!.title}](#challenge-${String(section.challenge!.challengeId)})`,
      )
    }
    if (matchedSections.length > 0) {
      lines.push("")
    }

    if (archivedSections.length > 0) {
      lines.push("### Archived Solver Writeups", "")
    }
    for (const section of archivedSections) {
      const inferredTitle = extractWriteupTitle(section.markdown)
      if (section.challenge) {
        continue
      }

      lines.push(
        inferredTitle
          ? `- [${inferredTitle} (${section.solverId})](#solver-${section.solverId})`
          : `- [${section.solverId} (archived)](#solver-${section.solverId})`,
      )
    }
    if (archivedSections.length > 0) {
      lines.push("")
    }
  }

  if (input.missing.length > 0) {
    lines.push("## Missing WriteUps", "")
    for (const challenge of input.missing) {
      lines.push(
        `- #${String(challenge.challengeId)} ${challenge.title} (${challenge.solverId}) - status: ${challenge.status}`,
      )
    }
    lines.push("")
  }

  lines.push("## Consolidated Writeups", "")
  if (input.sections.length === 0) {
    lines.push("No WriteUp.md files found in solver workspaces.")
    return lines.join("\n")
  }

  if (matchedSections.length > 0) {
    lines.push("### Tracked Challenge Writeups", "")
  }

  for (const section of matchedSections) {
    if (section.challenge) {
      const normalizedMarkdown = normalizeWriteupMarkdown(
        stripLeadingTitleHeading(section.markdown, section.challenge.title),
      )
      lines.push(
        `<a id="challenge-${String(section.challenge.challengeId)}"></a>\n`,
        `### #${String(section.challenge.challengeId)} ${section.challenge.title}`,
        "",
        `- Category: ${section.challenge.category}`,
        `- Score: ${String(section.challenge.score)}`,
        `- Solver: ${section.challenge.solverId}`,
        `- Runtime status: ${section.challenge.status}`,
        "",
        normalizedMarkdown,
        "",
      )
      continue
    }
  }

  if (archivedSections.length > 0) {
    lines.push("### Archived Solver Writeups", "")
  }

  for (const section of archivedSections) {
    const title = extractWriteupTitle(section.markdown) ?? section.solverId
    const normalizedMarkdown = normalizeWriteupMarkdown(
      stripLeadingTitleHeading(section.markdown, title),
    )

    lines.push(
      `<a id="solver-${section.solverId}"></a>`,
      `### ${title} (Archived Solver Writeup)`,
      "",
      "- Runtime challenge mapping: unavailable",
      "",
      normalizedMarkdown,
      "",
    )
  }

  return lines.join("\n")
}

function normalizeWriteupContent(markdown: string | undefined) {
  if (typeof markdown !== "string") {
    return ""
  }

  return markdown.replace(/\r\n/g, "\n").trim()
}

function extractWriteupTitle(markdown: string) {
  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^#{1,3}\s+(.+)$/)
    if (!heading) {
      continue
    }

    const title = heading[1].trim()
    if (title) {
      return title
    }
  }

  return undefined
}

function stripLeadingTitleHeading(markdown: string, fallbackTitle?: string) {
  const lines = markdown.split(/\r?\n/)
  const firstMeaningfulIndex = lines.findIndex((line) => line.trim().length > 0)
  if (firstMeaningfulIndex < 0) {
    return markdown
  }

  const firstLine = lines[firstMeaningfulIndex]
  const heading = firstLine.match(/^#{1,3}\s+(.+)$/)
  if (!heading) {
    return markdown
  }

  const headingTitle = heading[1].trim().toLowerCase()
  const normalizedFallback = fallbackTitle?.trim().toLowerCase()
  if (normalizedFallback && !headingTitle.includes(normalizedFallback)) {
    return markdown
  }

  const remaining = lines.slice(firstMeaningfulIndex + 1)
  while (remaining.length > 0 && remaining[0].trim().length === 0) {
    remaining.shift()
  }

  return remaining.join("\n")
}

function normalizeWriteupMarkdown(markdown: string) {
  return markdown
    .split(/\r?\n/)
    .map((line) => {
      const heading = line.match(/^(#{1,6})(\s+.*)$/)
      if (!heading) {
        return line
      }

      const level = Math.min(6, heading[1].length + 1)
      return `${"#".repeat(level)}${heading[2]}`
    })
    .join("\n")
    .trim()
}

function challengeStatusWeight(status: ChallengeSummaryView["status"]) {
  switch (status) {
    case "active":
      return 0
    case "queued":
      return 1
    case "model_unassigned":
      return 2
    case "solved":
      return 3
    case "blocked":
      return 4
    case "idle":
      return 5
  }
}

function toProviderCatalog(
  providers: Array<{ provider: string; models: Array<{ modelId: string; modelName: string }> }>,
): ProviderCatalogItem[] {
  return providers.map((provider) => ({
    provider: provider.provider,
    models: provider.models.map((model) => ({
      modelId: model.modelId,
      modelName: model.modelName,
    })),
  }))
}

function listBuiltinProviderCatalog(): ProviderCatalogItem[] {
  const workspace = createCTFRuntimeWorkspaceWithoutPersistence({ rootDir: APP_ROOT_DIR })
  return toProviderCatalog(workspace.listModelPoolCatalog())
}

function resolveChallengeStatus(input: {
  activationStatus?: ChallengeSummaryView["status"]
  progressStatus?: "idle" | "writeup_required" | "solved" | "blocked"
  queuedTaskId?: string
}): ChallengeSummaryView["status"] {
  if (input.activationStatus === "active") {
    return "active"
  }

  if (input.progressStatus === "solved") {
    return "solved"
  }

  if (input.progressStatus === "writeup_required" || input.progressStatus === "blocked") {
    return "blocked"
  }

  if (input.queuedTaskId) {
    return "queued"
  }

  if (input.activationStatus === "model_unassigned") {
    return "model_unassigned"
  }

  return "idle"
}

function resolveChallengeIdFromSolverId(solverId: string) {
  const matched = solverId.match(/^solver-(\d+)$/)
  if (!matched) {
    return undefined
  }

  const challengeId = Number(matched[1])
  return Number.isFinite(challengeId) ? challengeId : undefined
}

function isEnvironmentAgentAdapted(agent: RuntimeWorkspaceSession["environmentAgent"]) {
  if (!agent) {
    return false
  }

  const isRunning = isAgentRunning(agent)
  return !isRunning && agent.state.messages.length > 0
}

function resolveRuntimeSetupPhase(input: {
  initialized: boolean
  environmentAgentReady: boolean
  environmentAgentAdapted: boolean
}): RuntimeWorkspaceSnapshot["setupPhase"] {
  if (input.initialized) {
    return "ready"
  }

  if (input.environmentAgentAdapted) {
    return "env_agent_ready_for_settings"
  }

  if (input.environmentAgentReady) {
    return "env_agent_adapting"
  }

  return "plugin_pending"
}

function resolveChallengeIdFromPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return undefined
  }

  const challengeId = (payload as { challenge?: unknown }).challenge
  return typeof challengeId === "number" && Number.isFinite(challengeId) ? challengeId : undefined
}

async function applyPromptMode(
  agent: EnvironmentAgent | SolverAgent,
  prompt: string,
  mode: PromptMode,
) {
  const isRunning = isAgentRunning(agent)

  if (mode === "steer") {
    if (isRunning) {
      agent.steer(prompt)
      return
    }

    await Promise.resolve(agent.prompt(prompt))
    return
  }

  if (isRunning) {
    try {
      await Promise.resolve(agent.followUp(prompt))
      return
    } catch (error) {
      // Some engines reject follow-up while active task loop is running.
      // Fall back to steer so user input can still intervene in-flight.
      console.warn("followUp failed for running agent, fallback to steer", {
        error: error instanceof Error ? error.message : String(error),
      })
      agent.steer(prompt)
    }
    return
  }

  await Promise.resolve(agent.prompt(prompt))
}

function isAgentRunning(agent: EnvironmentAgent | SolverAgent) {
  const state = agent.state as { isRunning?: unknown; isStreaming?: unknown }
  if (typeof state.isRunning === "boolean") {
    return state.isRunning
  }

  if (typeof state.isStreaming === "boolean") {
    return state.isStreaming
  }

  return false
}
