import { randomUUID } from "node:crypto"
import { mkdir, readFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
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
  AgentMessagePart,
  AgentStateSnapshot,
  ChallengeSummaryView,
  PluginCatalogItem,
  PluginReadmeResponse,
  RuntimeCreateRequest,
  RuntimeWorkspaceSnapshot,
  SolverCreateRequest,
  SolverWorkspaceSnapshot,
  WorkspaceRegistryEntry,
  WsServerMessage,
} from "../../shared/protocol.ts"
import { EventBus } from "./event-bus.ts"
import { WorkspaceRegistryStore } from "./workspace-registry-store.ts"

const APP_ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const DEFAULT_WORKSPACE_ROOT = resolve(APP_ROOT_DIR, ".misuzu-web", "workspaces")

interface RuntimeWorkspaceSession {
  id: string
  workspace: CTFRuntimeWorkspace
  entry: WorkspaceRegistryEntry
  runtimeInitialized: boolean
  autoOrchestrate: boolean
  environmentAgent?: EnvironmentAgent
  environmentUnsubscribe?: () => void
  solverUnsubscribers: Map<string, () => void>
  autoQueuedChallenges: Set<number>
}

interface SolverWorkspaceSession {
  id: string
  workspace: SolverWorkspace
  entry: WorkspaceRegistryEntry
  mainAgentUnsubscribe?: () => void
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
        autoOrchestrate: Boolean(request.autoOrchestrate),
      },
    }

    const session = await this.createRuntimeSession(entry)
    session.autoOrchestrate = Boolean(request.autoOrchestrate)

    await this.applyModelPool(session.workspace, request.modelPool)

    if (request.pluginId) {
      await this.initializeRuntimeInternal(session, {
        pluginId: request.pluginId,
        pluginConfig: request.pluginConfig,
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
      session.workspace.pauseTaskDispatch()
    } else {
      if (autoEnqueue || session.autoOrchestrate) {
        this.enqueueManagedChallenges(session)
      }
      session.workspace.resumeTaskDispatch()
    }

    this.publishRuntimeSnapshot(session)
    return this.toRuntimeSnapshot(session)
  }

  async syncRuntimeChallenges(workspaceId: string) {
    const session = await this.requireRuntimeSession(workspaceId)
    this.ensureRuntimeInitialized(session)
    await session.workspace.syncChallengesOnce()
    this.bindRuntimeSolverAgents(session)

    if (session.autoOrchestrate) {
      this.enqueueManagedChallenges(session)
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

  async enqueueRuntimeChallenge(workspaceId: string, challengeId: number) {
    const session = await this.requireRuntimeSession(workspaceId)
    this.ensureRuntimeInitialized(session)

    void session.workspace.enqueueTask({ challenge: challengeId }).catch(() => {})
    this.publishRuntimeSnapshot(session)
    return this.toRuntimeSnapshot(session)
  }

  async getRuntimeSnapshot(workspaceId: string) {
    const session = await this.requireRuntimeSession(workspaceId)
    this.bindRuntimeSolverAgents(session)
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
    const agent = this.resolveRuntimeAgent(session, agentId)
    return this.toAgentSnapshot(agent)
  }

  async promptRuntimeAgent(workspaceId: string, agentId: string, prompt: string) {
    const session = await this.requireRuntimeSession(workspaceId)
    const agent = this.resolveRuntimeAgent(session, agentId)

    await agent.prompt(prompt)
    this.publishRuntimeSnapshot(session)

    return this.toAgentSnapshot(agent)
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

    return this.toAgentSnapshot(agent)
  }

  async promptSolver(workspaceId: string, prompt: string) {
    const session = await this.requireSolverSession(workspaceId)
    const agent = session.workspace.mainAgent
    if (!agent) {
      throw new Error("Solver workspace has no main agent yet")
    }

    await agent.prompt(prompt)
    this.publishSolverSnapshot(session)

    return this.toAgentSnapshot(agent)
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
      autoOrchestrate: Boolean(entry.runtime?.autoOrchestrate),
      solverUnsubscribers: new Map(),
      autoQueuedChallenges: new Set(),
    }

    this.runtimeSessions.set(entry.id, session)
    this.bindRuntimeSolverAgents(session)

    if (session.autoOrchestrate && session.runtimeInitialized) {
      this.enqueueManagedChallenges(session)
    }

    return session
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
    options: { pluginId: string; pluginConfig?: unknown },
  ) {
    if (!options.pluginConfig || typeof options.pluginConfig !== "object") {
      throw new Error("pluginConfig is required for runtime initialization")
    }

    const runtimeOptions: RuntimeInitOptions = {
      pluginId: options.pluginId,
      pluginConfig: options.pluginConfig as RuntimeInitOptions["pluginConfig"],
      startPaused: true,
    }

    await session.workspace.initializeRuntime(runtimeOptions)
    session.workspace.pauseTaskDispatch()
    session.runtimeInitialized = true
    session.entry = {
      ...session.entry,
      runtime: {
        initialized: true,
        pluginId: options.pluginId,
        autoOrchestrate: session.autoOrchestrate,
      },
    }
    this.bindRuntimeSolverAgents(session)

    if (session.autoOrchestrate) {
      this.enqueueManagedChallenges(session)
    }
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

  private resolveRuntimeAgent(session: RuntimeWorkspaceSession, agentId: string) {
    if (agentId === "environment") {
      return this.ensureEnvironmentAgent(session)
    }

    const solver = session.workspace.getSolverById(agentId)
    if (!solver) {
      throw new Error(`Runtime agent not found: ${agentId}`)
    }

    return solver
  }

  private toRuntimeSnapshot(session: RuntimeWorkspaceSession): RuntimeWorkspaceSnapshot {
    const activationByChallengeId = new Map<number, ChallengeSummaryView>()
    for (const activation of session.workspace.listSolverActivationStates()) {
      activationByChallengeId.set(activation.challengeId, {
        challengeId: activation.challengeId,
        solverId: activation.solverId,
        title: String(activation.challengeId),
        category: "unknown",
        score: 0,
        solvedCount: 0,
        status: activation.status === "active" ? "active" : "idle",
        activeTaskId: activation.activeTaskId,
        modelId: activation.modelId,
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

      activationByChallengeId.set(challenge.challengeId, {
        challengeId: challenge.challengeId,
        solverId: challenge.solverId,
        title: challenge.title,
        category: challenge.category,
        score: challenge.score,
        solvedCount: challenge.solvedCount,
        status,
        activeTaskId: existing?.activeTaskId,
        queuedTaskId,
        statusReason: status === "blocked" ? progress?.blockedReason : undefined,
        modelId: existing?.modelId,
      })
    }

    const challenges = [...activationByChallengeId.values()].sort(
      (left, right) =>
        challengeStatusWeight(left.status) - challengeStatusWeight(right.status) ||
        left.challengeId - right.challengeId,
    )

    const agents: RuntimeWorkspaceSnapshot["agents"] = []
    if (session.environmentAgent) {
      agents.push({
        id: "environment",
        name: "Environment Agent",
        role: "environment",
      })
    }

    for (const challenge of challenges) {
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
      pluginId: session.runtimeInitialized
        ? (session.workspace.getPersistedRuntimeOptions()?.pluginId ??
          session.entry.runtime?.pluginId)
        : session.entry.runtime?.pluginId,
      paused: session.workspace.isTaskDispatchPaused(),
      queue: session.workspace.getSchedulerState(),
      challenges,
      agents,
      environmentAgentReady: Boolean(session.environmentAgent),
      autoOrchestrate: session.autoOrchestrate,
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

  private toAgentSnapshot(agent: EnvironmentAgent | SolverAgent): AgentStateSnapshot {
    const model = agent.state.model
    return {
      modelId: model ? `${model.provider}/${model.id}` : undefined,
      thinkingLevel: agent.state.thinkingLevel,
      isRunning: Boolean((agent.state as { isRunning?: boolean }).isRunning),
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

  private enqueueManagedChallenges(session: RuntimeWorkspaceSession) {
    const challengeIds = session.workspace
      .listManagedChallenges()
      .map((challenge) => challenge.challengeId)
      .sort((left, right) => left - right)

    for (const challengeId of challengeIds) {
      if (session.autoQueuedChallenges.has(challengeId)) {
        continue
      }

      session.autoQueuedChallenges.add(challengeId)
      void session.workspace.enqueueTask({ challenge: challengeId }).catch(() => {
        session.autoQueuedChallenges.delete(challengeId)
      })
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

  private persistRuntimeEntry(session: RuntimeWorkspaceSession) {
    const runtimeOptions = session.workspace.getPersistedRuntimeOptions()
    const now = new Date().toISOString()
    session.entry = {
      ...session.entry,
      updatedAt: now,
      runtime: {
        initialized: session.runtimeInitialized,
        pluginId: runtimeOptions?.pluginId ?? session.entry.runtime?.pluginId,
        autoOrchestrate: session.autoOrchestrate,
      },
    }
  }

  private publishRuntimeSnapshot(session: RuntimeWorkspaceSession) {
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

function challengeStatusWeight(status: ChallengeSummaryView["status"]) {
  switch (status) {
    case "active":
      return 0
    case "queued":
      return 1
    case "solved":
      return 2
    case "blocked":
      return 3
    case "idle":
      return 4
  }
}

function resolveChallengeStatus(input: {
  activationStatus?: ChallengeSummaryView["status"]
  progressStatus?: "idle" | "writeup_required" | "solved" | "blocked"
  queuedTaskId?: string
}): ChallengeSummaryView["status"] {
  if (input.activationStatus === "active") {
    return "active"
  }

  if (input.queuedTaskId) {
    return "queued"
  }

  if (input.progressStatus === "solved") {
    return "solved"
  }

  if (input.progressStatus === "writeup_required" || input.progressStatus === "blocked") {
    return "blocked"
  }

  return "idle"
}

function resolveChallengeIdFromPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return undefined
  }

  const challengeId = (payload as { challenge?: unknown }).challenge
  return typeof challengeId === "number" && Number.isFinite(challengeId) ? challengeId : undefined
}

function extractMessageParts(content: unknown): AgentMessagePart[] {
  if (typeof content === "string") {
    return [{ kind: "text", text: content }]
  }

  if (!Array.isArray(content)) {
    return []
  }

  const parts: AgentMessagePart[] = []
  for (const item of content) {
    const normalized = normalizeMessagePart(item)
    if (normalized) {
      parts.push(normalized)
    }
  }

  return parts
}

function normalizeMessagePart(part: unknown): AgentMessagePart | undefined {
  if (!part || typeof part !== "object") {
    return undefined
  }

  const typedPart = part as Record<string, unknown>
  const partType = typeof typedPart.type === "string" ? typedPart.type : undefined
  if (partType === "text" && typeof typedPart.text === "string") {
    return {
      kind: "text",
      text: typedPart.text,
    }
  }

  if (typeof typedPart.text === "string" && typedPart.text.trim().length > 0) {
    return {
      kind: "text",
      text: typedPart.text,
    }
  }

  const name = readFirstStringField(typedPart, ["toolName", "name", "tool", "label"])
  const args = readFirstDefinedField(typedPart, ["args", "input", "arguments"])
  const result = readFirstDefinedField(typedPart, ["result", "output", "details", "content"])

  if (partType?.includes("tool") || name || args !== undefined || result !== undefined) {
    return {
      kind: "tool",
      toolType: partType ?? "tool",
      name,
      argsText: args === undefined ? undefined : serializeForMessageText(args),
      resultText: result === undefined ? undefined : serializeForMessageText(result),
    }
  }

  return undefined
}

function renderMessagePartsAsText(parts: AgentMessagePart[]) {
  return parts
    .map((part) => {
      if (part.kind === "text") {
        return part.text
      }

      const lines: string[] = []
      lines.push(part.name ? `[${part.toolType}] ${part.name}` : `[${part.toolType}]`)

      if (part.argsText !== undefined) {
        lines.push(`args: ${part.argsText}`)
      }

      if (part.resultText !== undefined) {
        lines.push(`result: ${part.resultText}`)
      }

      return lines.join("\n")
    })
    .filter((text) => text.trim().length > 0)
    .join("\n\n")
}

function readFirstStringField(part: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = part[key]
    if (typeof value === "string" && value.trim().length > 0) {
      return value
    }
  }

  return undefined
}

function readFirstDefinedField(part: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = part[key]
    if (value !== undefined) {
      return value
    }
  }

  return undefined
}

function serializeForMessageText(value: unknown) {
  if (typeof value === "string") {
    return value
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
