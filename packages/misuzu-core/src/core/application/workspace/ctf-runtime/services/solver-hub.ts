import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { AgentTool } from "@mariozechner/pi-agent-core"
import { type SolverAgent, type SolverAgentOptions } from "../../../../../agents/solver.ts"
import { createBaseTools } from "../../../../../tools/index.ts"
import type { Logger } from "../../../../infrastructure/logging/types.ts"
import {
  PlatformAuthError,
  transformPluginToTools,
  type CTFPlatformPlugin,
  type ChallengeDetail,
  type ChallengeSummary,
  type PlatformRequestContext,
  type SolverToolPlugin,
} from "../../../../../../plugins/index.ts"
import type { RuntimeInitOptions } from "./orchestrator.ts"
import { type SolverTask, type SolverTaskResult, QueueService } from "./queue.ts"
import { SolverWorkspaceService } from "./solver-workspaces.ts"
import { PlatformAuthManager } from "./auth-manager.ts"
import { PlatformContestManager } from "./contest-manager.ts"
import { RuntimePluginLoader } from "./plugin-loader.ts"
import { WorkspaceModelPool, isModelPoolError } from "./model-pool.ts"
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

export interface ChallengeSolverActivationState {
  challengeId: number
  solverId: string
  status: "inactive" | "active"
  activeTaskId?: string
  modelId?: string
}

export interface SolverHubDeps {
  logger: Logger
  queue: QueueService
  solverWorkspaces: SolverWorkspaceService
  modelPool: WorkspaceModelPool
}

export class SolverHub {
  private platformPlugin?: CTFPlatformPlugin
  private platformPluginId?: string
  private platformBaseUrl?: string
  private platformNoticeCursor?: string
  private readonly challengeSolvers = new Map<number, ChallengeSolverBinding>()

  private readonly logger: Logger
  private readonly queue: QueueService
  private readonly solverWorkspaces: SolverWorkspaceService
  private readonly modelPool: WorkspaceModelPool
  private readonly pluginLoader = new RuntimePluginLoader()
  private readonly authManager: PlatformAuthManager
  private readonly contestManager: PlatformContestManager
  private onStateChanged: () => void = () => {}

  constructor(deps: SolverHubDeps) {
    this.logger = deps.logger
    this.queue = deps.queue
    this.solverWorkspaces = deps.solverWorkspaces
    this.modelPool = deps.modelPool
    this.authManager = new PlatformAuthManager({
      onStateChanged: () => this.notifyStateChanged(),
    })
    this.contestManager = new PlatformContestManager({
      onStateChanged: () => this.notifyStateChanged(),
    })
  }

  setStateChangeListener(listener: () => void) {
    this.onStateChanged = listener
  }

  async initialize(options: RuntimeInitOptions) {
    if (this.platformPlugin) {
      throw new Error("Platform runtime is already initialized")
    }

    const { plugin, pluginId } = await this.pluginLoader.resolve({
      plugin: options.plugin,
      pluginId: options.pluginId,
    })

    await plugin.setup(options.pluginConfig)

    this.platformPlugin = plugin
    this.platformPluginId = pluginId
    this.platformBaseUrl = options.pluginConfig.baseUrl
    this.authManager.initialize({
      plugin,
      authConfig: options.pluginConfig.auth,
      restoredSession: options.restore?.authSession,
    })
    this.contestManager.initialize({
      binding: options.pluginConfig.contest,
      restoredContestId: options.restore?.contestId,
    })
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

  getSolverActivationState(challengeId: number): ChallengeSolverActivationState | undefined {
    const binding = this.challengeSolvers.get(challengeId)
    if (!binding) {
      return undefined
    }

    return this.buildActivationState(binding)
  }

  listSolverActivationStates(): ChallengeSolverActivationState[] {
    return [...this.challengeSolvers.values()].map((binding) => this.buildActivationState(binding))
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
      authSession: this.authManager.getSessionState(),
      contestId: this.contestManager.getContestIdState(),
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

    solver.setTools([...createBaseTools(managedSolver.rootDir), ...this.createPlatformTools()])

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
    const preferredModel = binding.solver.state.model
      ? {
          provider: binding.solver.state.model.provider,
          modelId: binding.solver.state.model.id,
        }
      : undefined
    const modelLease = this.acquireModelLeaseForSolver(preferredModel)

    try {
      const currentModel = binding.solver.state.model
      if (
        !currentModel ||
        currentModel.provider !== modelLease.model.provider ||
        currentModel.id !== modelLease.model.id
      ) {
        binding.solver.setModel(modelLease.model)
      }

      await binding.solver.prompt(buildSolverTaskPrompt(binding.challenge, task.payload))
    } finally {
      modelLease.release()
    }

    const output: SolverTaskResult["output"] = {
      challengeId: binding.challenge.id,
      solverId: binding.solverId,
      messageCount: binding.solver.state.messages.length,
    }

    return output
  }

  private acquireModelLeaseForSolver(
    preferredModel: { provider: string; modelId: string } | undefined,
  ) {
    if (!preferredModel) {
      return this.modelPool.acquire()
    }

    try {
      return this.modelPool.acquire(preferredModel)
    } catch (error) {
      if (
        !isModelPoolError(error) ||
        (error.code !== "MODEL_NOT_IN_POOL" && error.code !== "MODEL_NOT_AVAILABLE")
      ) {
        throw error
      }

      // Allow restored/unactivated solvers to migrate onto current pool configuration.
      return this.modelPool.acquire()
    }
  }

  private createPlatformTools() {
    const pluginId = this.getPluginId()
    const platformTools = transformPluginToTools(this.createSolverToolPlugin(), {
      namespace: pluginId,
    })

    return platformTools as unknown as AgentTool<any>[]
  }

  private createSolverToolPlugin(): SolverToolPlugin {
    const plugin = this.requirePlugin()

    return {
      meta: {
        id: this.getPluginId(),
        name: plugin.meta.name,
      },
      listChallenges: async () => this.listChallenges(),
      getChallenge: async (challengeId: number) => this.getChallenge(challengeId),
      submitFlagRaw: async (challengeId: number, flag: string) =>
        this.submitFlag(challengeId, flag),
      downloadAttachment: async (challengeId: number, attachmentIndex: number, fileName?: string) =>
        this.downloadAttachmentForSolver(challengeId, attachmentIndex, fileName),
      openContainer: plugin.openContainer
        ? async (challengeId: number) => this.openContainer(challengeId)
        : undefined,
      destroyContainer: plugin.destroyContainer
        ? async (challengeId: number) => this.destroyContainer(challengeId)
        : undefined,
    }
  }

  private buildActivationState(binding: ChallengeSolverBinding): ChallengeSolverActivationState {
    const executionState = this.queue.getSolverExecutionState(binding.solverId)
    const model = binding.solver.state.model

    return {
      challengeId: binding.challenge.id,
      solverId: binding.solverId,
      status: executionState.active ? "active" : "inactive",
      activeTaskId: executionState.activeTaskId,
      modelId: model ? `${model.provider}/${model.id}` : undefined,
    }
  }

  private async downloadAttachmentForSolver(
    challengeId: number,
    attachmentIndex: number,
    fileName?: string,
  ) {
    const binding = this.challengeSolvers.get(challengeId)
    if (!binding) {
      throw new Error(`Challenge solver is not managed: ${String(challengeId)}`)
    }

    const detail = binding.detail ?? (await this.getChallenge(challengeId))
    binding.detail = detail

    const attachment = detail.attachments[attachmentIndex]
    if (!attachment) {
      throw new Error(
        `Attachment index out of range for challenge ${String(challengeId)}: ${String(attachmentIndex)}`,
      )
    }

    const response = await this.withRuntimeContext(async (context) => {
      const headers = new Headers()
      if (context.session.cookie) {
        headers.set("cookie", context.session.cookie)
      }
      if (context.session.bearerToken) {
        headers.set("authorization", `Bearer ${context.session.bearerToken}`)
      }

      const resolvedUrl = resolveAttachmentUrl(attachment.url, this.platformBaseUrl)
      const result = await fetch(resolvedUrl, { headers })
      if (result.status === 401 || result.status === 403) {
        throw new PlatformAuthError(
          `Attachment download requires re-authentication (${String(result.status)})`,
        )
      }

      if (!result.ok) {
        throw new Error(
          `Attachment download failed (${String(result.status)}) for challenge ${String(challengeId)}`,
        )
      }

      return result
    })

    const attachmentDir = await this.ensureSolverAttachmentDir(binding.solverId, challengeId)
    const outputName = sanitizeAttachmentFileName(fileName ?? attachment.name, attachmentIndex)
    const outputPath = join(attachmentDir, outputName)
    const content = Buffer.from(await response.arrayBuffer())
    await writeFile(outputPath, content)

    return {
      challengeId,
      solverId: binding.solverId,
      attachmentIndex,
      attachmentName: outputName,
      sourceUrl: attachment.url,
      filePath: outputPath,
      sizeBytes: content.byteLength,
      contentType: response.headers.get("content-type") ?? undefined,
    }
  }

  private async ensureSolverAttachmentDir(solverId: string, challengeId: number) {
    const workspace = await this.solverWorkspaces.getOrCreateWorkspace(solverId)
    const attachmentDir = join(workspace.rootDir, "attachments", String(challengeId))
    await mkdir(attachmentDir, { recursive: true })
    return attachmentDir
  }

  private requirePlugin() {
    if (!this.platformPlugin) {
      throw new Error("Platform runtime is not initialized")
    }

    return this.platformPlugin
  }

  private async withRuntimeContext<T>(
    operation: (context: PlatformRequestContext) => Promise<T>,
  ): Promise<T> {
    return this.authManager.withSession(async (session) => {
      const contestId = await this.contestManager.resolveContestId(async () =>
        this.requirePlugin().listContests(session),
      )

      return operation({
        session,
        contestId,
      })
    })
  }

  private async ensureRuntimeContext(): Promise<PlatformRequestContext> {
    return this.withRuntimeContext(async (context) => context)
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
    "Use platform download_attachment tool for authenticated attachment downloads.",
  ].join("\n")
}

function resolveAttachmentUrl(attachmentUrl: string, platformBaseUrl: string | undefined) {
  try {
    return new URL(attachmentUrl).toString()
  } catch {
    if (!platformBaseUrl) {
      throw new Error(`Cannot resolve relative attachment URL without base URL: ${attachmentUrl}`)
    }

    const base = platformBaseUrl.endsWith("/") ? platformBaseUrl : `${platformBaseUrl}/`
    return new URL(attachmentUrl, base).toString()
  }
}

function sanitizeAttachmentFileName(name: string, attachmentIndex: number) {
  const withoutReservedChars = name.replace(/[<>:"/\\|?*]/g, "_")
  const withoutControlChars = withoutReservedChars
    .split("")
    .map((char) => {
      const code = char.charCodeAt(0)
      return code >= 0 && code <= 31 ? "_" : char
    })
    .join("")

  const safe = withoutControlChars.replace(/\s+/g, " ").trim().replace(/^\.+$/, "")

  return safe.length > 0 ? safe : `attachment-${String(attachmentIndex)}`
}

function buildSolverTaskPrompt(challenge: ChallengeSummary, payload: unknown) {
  const payloadText = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2)

  return [
    `You are assigned to challenge [${challenge.id}] ${challenge.title}.`,
    `Category: ${challenge.category}, score: ${challenge.score}, solved: ${challenge.solvedCount}.`,
    "Use platform tools carefully and avoid unnecessary requests.",
    `Task payload:\n${payloadText}`,
  ].join("\n")
}
