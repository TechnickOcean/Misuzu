import { pathToFileURL } from "node:url"
import type { AgentTool } from "@mariozechner/pi-agent-core"
import { type SolverAgent, type SolverAgentOptions } from "../../../../../agents/solver.ts"
import {
  findBuiltinPlugin,
  loadBuiltinPluginCatalog,
  resolveBuiltinPluginEntryPath,
} from "../../../../../plugins/catalog.ts"
import { createBaseTools } from "../../../../../tools/index.ts"
import type { Logger } from "../../../../infrastructure/logging/types.ts"
import {
  isPlatformAuthError,
  transformPluginToTools,
  type AuthSession,
  type CTFPlatformPlugin,
  type ChallengeDetail,
  type ChallengeSummary,
  type ContestBinding,
  type ContestSummary,
  type PluginAuthConfig,
  type PlatformRequestContext,
  type SolverToolPlugin,
} from "../../../../../../plugins/index.ts"
import type { RuntimeInitOptions } from "./orchestrator.ts"
import { type SolverTask, type SolverTaskResult, QueueService } from "./queue.ts"
import { SolverWorkspaceService } from "./solver-workspaces.ts"
import type {
  PersistedCTFRuntimePlatformState,
  PersistedCTFRuntimeSolverHubState,
} from "../state.ts"

export interface ChallengeSolverBinding {
  challenge: ChallengeSummary
  detail?: ChallengeDetail
  solverId: string
  solver: SolverAgent
}

export interface SolverHubDeps {
  logger: Logger
  queue: QueueService
  solverWorkspaces: SolverWorkspaceService
}

export class SolverHub {
  private platformPlugin?: CTFPlatformPlugin
  private platformPluginId?: string
  private platformAuthConfig?: PluginAuthConfig
  private platformContestBinding: ContestBinding = { mode: "auto" }
  private platformSession?: AuthSession
  private platformContestId?: number
  private platformNoticeCursor?: string
  private readonly challengeSolvers = new Map<number, ChallengeSolverBinding>()

  private readonly logger: Logger
  private readonly queue: QueueService
  private readonly solverWorkspaces: SolverWorkspaceService
  private onStateChanged: () => void = () => {}

  constructor(deps: SolverHubDeps) {
    this.logger = deps.logger
    this.queue = deps.queue
    this.solverWorkspaces = deps.solverWorkspaces
  }

  setStateChangeListener(listener: () => void) {
    this.onStateChanged = listener
  }

  async initialize(options: RuntimeInitOptions) {
    if (this.platformPlugin) {
      throw new Error("Platform runtime is already initialized")
    }

    const plugin = options.plugin ?? (await this.resolvePluginOrThrow(options.pluginId))
    const pluginId = options.pluginId ?? plugin.meta.id

    await plugin.setup(options.pluginConfig)

    this.platformPlugin = plugin
    this.platformPluginId = pluginId
    this.platformAuthConfig = options.pluginConfig.auth
    this.platformContestBinding = options.pluginConfig.contest
    this.platformSession = this.normalizeAuthSession(options.restore?.authSession)
    this.platformContestId = options.restore?.contestId
    this.platformNoticeCursor = options.restore?.noticeCursor

    await this.ensureRuntimeContext()
    this.notifyStateChanged()
  }

  getManagedChallengeIds() {
    return [...this.challengeSolvers.keys()]
  }

  getChallengeSolver(challengeId: number) {
    return this.challengeSolvers.get(challengeId)?.solver
  }

  getChallengeBindings() {
    return [...this.challengeSolvers.values()]
  }

  getChallengeBinding(challengeId: number) {
    return this.challengeSolvers.get(challengeId)
  }

  getPluginId() {
    return this.platformPluginId ?? this.requirePlugin().meta.id
  }

  getNoticeCursor() {
    return this.platformNoticeCursor
  }

  setNoticeCursor(cursor: string | undefined) {
    this.platformNoticeCursor = cursor
    this.notifyStateChanged()
  }

  getPlatformState(): PersistedCTFRuntimePlatformState {
    return {
      authSession: this.platformSession,
      contestId: this.platformContestId,
    }
  }

  async listChallenges() {
    return this.withRuntimeContext(async (context) => this.requirePlugin().listChallenges(context))
  }

  async getChallenge(challengeId: number) {
    return this.withRuntimeContext(async (context) =>
      this.requirePlugin().getChallenge({
        ...context,
        challengeId,
      }),
    )
  }

  async submitFlag(challengeId: number, flag: string) {
    return this.withRuntimeContext(async (context) =>
      this.requirePlugin().submitFlagRaw({
        ...context,
        challengeId,
        flag,
      }),
    )
  }

  async pollUpdates(cursor?: string) {
    return this.withRuntimeContext(async (context) =>
      this.requirePlugin().pollUpdates({
        ...context,
        cursor,
      }),
    )
  }

  async openContainer(challengeId: number) {
    return this.withRuntimeContext(async (context) => {
      const plugin = this.requirePlugin()
      if (!plugin.openContainer) {
        throw new Error(`Platform plugin ${this.getPluginId()} does not support openContainer`)
      }

      return plugin.openContainer({
        ...context,
        challengeId,
      })
    })
  }

  async destroyContainer(challengeId: number) {
    return this.withRuntimeContext(async (context) => {
      const plugin = this.requirePlugin()
      if (!plugin.destroyContainer) {
        throw new Error(`Platform plugin ${this.getPluginId()} does not support destroyContainer`)
      }

      return plugin.destroyContainer({
        ...context,
        challengeId,
      })
    })
  }

  snapshotState(): PersistedCTFRuntimeSolverHubState {
    return {
      managedChallenges: [...this.challengeSolvers.values()].map((binding) => ({
        challengeId: binding.challenge.id,
        solverId: binding.solverId,
        title: binding.challenge.title,
        category: binding.challenge.category,
        score: binding.challenge.score,
        solvedCount: binding.challenge.solvedCount,
      })),
    }
  }

  async ensureChallengeSolver(challenge: ChallengeSummary) {
    const existing = this.challengeSolvers.get(challenge.id)
    if (existing) {
      return existing
    }

    const detail = await this.getChallenge(challenge.id)

    const solverId = `solver-${challenge.id}`
    const managedSolver = await this.createSolver(solverId, {
      initialState: {
        systemPrompt: buildChallengeSolverPrompt(challenge, detail, this.getPluginId()),
      },
    })
    const solver = managedSolver.solver

    const platformTools = transformPluginToTools(this.createSolverToolPlugin(), {
      namespace: this.getPluginId(),
    }) as unknown as AgentTool<any>[]
    solver.setTools([...createBaseTools(managedSolver.rootDir), ...platformTools])

    const binding: ChallengeSolverBinding = {
      challenge,
      detail,
      solver,
      solverId,
    }

    this.challengeSolvers.set(challenge.id, binding)
    this.queue.registerSolver({
      solverId,
      solve: async (task) => this.solveWithBinding(binding, task),
    })
    this.notifyStateChanged()

    this.logger.info("Challenge solver created", {
      challengeId: challenge.id,
      challengeTitle: challenge.title,
      solverId,
    })

    return binding
  }

  updateChallengeMetadata(challenge: ChallengeSummary) {
    const existing = this.challengeSolvers.get(challenge.id)
    if (!existing) {
      return false
    }

    const changed =
      existing.challenge.score !== challenge.score ||
      existing.challenge.solvedCount !== challenge.solvedCount ||
      existing.challenge.title !== challenge.title ||
      existing.challenge.category !== challenge.category

    if (!changed) {
      return false
    }

    const previous = existing.challenge
    existing.challenge = challenge
    existing.solver.steer(
      [
        `Platform challenge metadata updated for [${challenge.id}] ${challenge.title}.`,
        `Score: ${previous.score} -> ${challenge.score}`,
        `Solved count: ${previous.solvedCount} -> ${challenge.solvedCount}`,
        "Re-check whether this changes exploit assumptions or expected flag path.",
      ].join("\n"),
    )

    this.notifyStateChanged()

    return true
  }

  private async createSolver(solverId: string, options: SolverAgentOptions) {
    return this.solverWorkspaces.getOrCreateSolver(solverId, options)
  }

  private async solveWithBinding(binding: ChallengeSolverBinding, task: SolverTask) {
    const payloadText =
      typeof task.payload === "string" ? task.payload : JSON.stringify(task.payload, null, 2)

    await binding.solver.prompt(
      [
        `You are assigned to challenge [${binding.challenge.id}] ${binding.challenge.title}.`,
        `Category: ${binding.challenge.category}, score: ${binding.challenge.score}, solved: ${binding.challenge.solvedCount}.`,
        "Use platform tools carefully and avoid unnecessary requests.",
        `Task payload:\n${payloadText}`,
      ].join("\n"),
    )

    const output: SolverTaskResult["output"] = {
      challengeId: binding.challenge.id,
      solverId: binding.solverId,
      messageCount: binding.solver.state.messages.length,
    }

    return output
  }

  private createSolverToolPlugin(): SolverToolPlugin {
    return {
      meta: {
        id: this.getPluginId(),
        name: this.requirePlugin().meta.name,
      },
      listChallenges: async () => this.listChallenges(),
      getChallenge: async (challengeId: number) => this.getChallenge(challengeId),
      submitFlagRaw: async (challengeId: number, flag: string) =>
        this.submitFlag(challengeId, flag),
      openContainer: this.requirePlugin().openContainer
        ? async (challengeId: number) => this.openContainer(challengeId)
        : undefined,
      destroyContainer: this.requirePlugin().destroyContainer
        ? async (challengeId: number) => this.destroyContainer(challengeId)
        : undefined,
    }
  }

  private requirePlugin() {
    if (!this.platformPlugin) {
      throw new Error("Platform runtime is not initialized")
    }

    return this.platformPlugin
  }

  private async withRuntimeContext<T>(
    operation: (context: PlatformRequestContext) => Promise<T>,
    allowRetry = true,
  ): Promise<T> {
    const context = await this.ensureRuntimeContext()

    try {
      return await operation(context)
    } catch (error) {
      if (!allowRetry || !isPlatformAuthError(error)) {
        throw error
      }

      this.platformSession = undefined
      const refreshedContext = await this.ensureRuntimeContext()
      return operation(refreshedContext)
    }
  }

  private async ensureRuntimeContext(): Promise<PlatformRequestContext> {
    const session = await this.ensureSession()
    const contestId = await this.ensureContestId(session)

    return {
      session,
      contestId,
    }
  }

  private async ensureSession() {
    const plugin = this.requirePlugin()

    if (this.platformSession) {
      try {
        await plugin.validateSession(this.platformSession)
        return this.platformSession
      } catch (error) {
        if (!isPlatformAuthError(error)) {
          throw error
        }

        this.platformSession = undefined
      }
    }

    const session = await plugin.login(this.platformAuthConfig)
    this.platformSession = session
    this.notifyStateChanged()
    return session
  }

  private async ensureContestId(session: AuthSession) {
    const plugin = this.requirePlugin()
    const contests = await plugin.listContests(session)

    if (contests.length === 0) {
      throw new Error("No contests found for this platform")
    }

    if (typeof this.platformContestId === "number") {
      if (contests.some((contest) => contest.id === this.platformContestId)) {
        return this.platformContestId
      }

      this.platformContestId = undefined
    }

    const selected = selectContestByBinding(contests, this.platformContestBinding)
    if (!selected) {
      throw new Error(`Unable to bind contest for mode: ${this.platformContestBinding.mode}`)
    }

    this.platformContestId = selected.id
    this.notifyStateChanged()
    return selected.id
  }

  private normalizeAuthSession(session: AuthSession | undefined) {
    if (!session) {
      return undefined
    }

    if (!isAuthMode(session.mode)) {
      return undefined
    }

    if (typeof session.refreshable !== "boolean") {
      return undefined
    }

    return {
      mode: session.mode,
      cookie: typeof session.cookie === "string" ? session.cookie : undefined,
      bearerToken: typeof session.bearerToken === "string" ? session.bearerToken : undefined,
      expiresAt: typeof session.expiresAt === "number" ? session.expiresAt : undefined,
      refreshable: session.refreshable,
    } satisfies AuthSession
  }

  private async resolvePluginOrThrow(pluginId: string | undefined) {
    if (!pluginId) {
      throw new Error(
        "Missing pluginId in runtime config. Select a plugin from built-in plugin catalog.",
      )
    }

    const pluginEntry = findBuiltinPlugin(pluginId)
    if (!pluginEntry) {
      const availableIds = loadBuiltinPluginCatalog().map((entry) => entry.id)
      throw new Error(
        `Required plugin is missing from catalog: ${pluginId}. Available plugins: ${availableIds.join(", ") || "none"}`,
      )
    }

    const plugin = await this.loadPluginFromPath(resolveBuiltinPluginEntryPath(pluginEntry))

    if (plugin.meta.id !== pluginId) {
      throw new Error(`Platform plugin id mismatch: expected ${pluginId}, actual ${plugin.meta.id}`)
    }

    return plugin
  }

  private async loadPluginFromPath(modulePath: string) {
    const moduleUrl = pathToFileURL(modulePath).href
    const pluginModule = (await import(moduleUrl)) as Record<string, unknown>

    const createPlugin = this.resolvePluginFactory(pluginModule)
    const plugin = createPlugin()
    const candidate = plugin as Partial<CTFPlatformPlugin> | null

    if (!candidate || typeof candidate !== "object" || typeof candidate.setup !== "function") {
      throw new Error(
        `Invalid platform plugin module. Expected a plugin factory export from ${modulePath}.`,
      )
    }

    return candidate as CTFPlatformPlugin
  }

  private resolvePluginFactory(pluginModule: Record<string, unknown>) {
    const namedCreatePlugin = pluginModule.createPlugin
    if (typeof namedCreatePlugin === "function") {
      return namedCreatePlugin as () => unknown
    }

    for (const [name, value] of Object.entries(pluginModule)) {
      if (name.startsWith("create") && name.endsWith("Plugin") && typeof value === "function") {
        return value as () => unknown
      }
    }

    const defaultExport = pluginModule.default
    if (typeof defaultExport === "function") {
      return () => {
        try {
          return new (defaultExport as new () => unknown)()
        } catch {
          return (defaultExport as () => unknown)()
        }
      }
    }

    if (defaultExport && typeof defaultExport === "object") {
      return () => defaultExport
    }

    throw new Error("Plugin module has no supported factory export")
  }

  private notifyStateChanged() {
    this.onStateChanged()
  }
}

function buildChallengeSolverPrompt(
  challenge: ChallengeSummary,
  detail: ChallengeDetail,
  pluginId: string,
) {
  const attachments = detail.attachments.length
    ? detail.attachments.map((item) => `- ${item.name} (${item.kind}): ${item.url}`).join("\n")
    : "- none"

  const hints = detail.hints.length ? detail.hints.map((hint) => `- ${hint}`).join("\n") : "- none"

  return [
    `Assigned platform plugin: ${pluginId}`,
    `Assigned challenge id: ${challenge.id}`,
    `Title: ${challenge.title}`,
    `Category: ${challenge.category}`,
    `Score: ${challenge.score}`,
    `Solved count: ${challenge.solvedCount}`,
    "Challenge description:",
    detail.content,
    "Hints:",
    hints,
    "Attachments:",
    attachments,
  ].join("\n")
}

function selectContestByBinding(contests: ContestSummary[], binding: ContestBinding) {
  switch (binding.mode) {
    case "id":
      return contests.find((contest) => contest.id === binding.value)
    case "title":
      return contests.find((contest) => contest.title === binding.value)
    case "url": {
      const contestId = parseContestIdFromUrl(binding.value)
      return contests.find((contest) => contest.id === contestId)
    }
    case "auto": {
      const now = Date.now()
      return (
        contests.find(
          (contest) =>
            typeof contest.start === "number" &&
            typeof contest.end === "number" &&
            contest.start <= now &&
            now <= contest.end,
        ) ?? contests[0]
      )
    }
  }
}

function parseContestIdFromUrl(url: string) {
  const match = /\/games\/(\d+)/.exec(url)
  if (!match) {
    throw new Error(`Unable to parse contest id from URL: ${url}`)
  }

  return Number(match[1])
}

function isAuthMode(value: unknown): value is AuthSession["mode"] {
  return value === "manual" || value === "cookie" || value === "token" || value === "credentials"
}
