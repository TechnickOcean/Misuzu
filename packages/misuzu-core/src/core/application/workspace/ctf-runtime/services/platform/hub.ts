import { access, mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { AgentTool } from "@mariozechner/pi-agent-core"
import { type SolverAgent, type SolverAgentOptions } from "../../../../../../agents/solver.ts"
import { createBaseTools } from "../../../../../../tools/index.ts"
import type { Logger } from "../../../../../infrastructure/logging/types.ts"
import {
  PlatformAuthError,
  transformPluginToTools,
  type CTFPlatformPlugin,
  type ChallengeDetail,
  type ChallengeSummary,
  type PlatformRequestContext,
  type SolverToolPlugin,
} from "../../../../../../../plugins/index.ts"
import type { RuntimeInitOptions } from "./runtime.ts"
import { type SolverTask, type SolverTaskResult, QueueService } from "../scheduler/queue.ts"
import { SolverWorkspaceService } from "../solver/workspaces.ts"
import { PlatformAuthManager } from "./auth.ts"
import { PlatformContestManager } from "./contest.ts"
import { RuntimePluginLoader } from "./plugin.ts"
import { WorkspaceModelPool, isModelPoolError } from "../model/pool.ts"
import type {
  PersistedCTFRuntimeChallengeProgress,
  PersistedCTFRuntimePlatformState,
  PersistedCTFRuntimeSolverHubState,
} from "../../state.ts"

export interface ChallengeSolverBinding {
  challenge: ChallengeSummary
  detail?: ChallengeDetail
  solverId: string
  rootDir: string
  solver: SolverAgent
}

export interface ChallengeSolverActivationState {
  challengeId: number
  solverId: string
  status: "inactive" | "active"
  activeTaskId?: string
  modelId?: string
}

export type ChallengeProgressStatus = "idle" | "writeup_required" | "solved" | "blocked"

export interface ChallengeSolverProgressState {
  challengeId: number
  solverId: string
  status: ChallengeProgressStatus
  flagAccepted: boolean
  writeUpReady: boolean
  blockedReason?: string
}

export interface UnexpectedSolverStopEvent {
  challengeId: number
  solverId: string
  taskId: string
  error: unknown
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
  private readonly challengeProgress = new Map<number, ChallengeSolverProgressState>()

  private readonly logger: Logger
  private readonly queue: QueueService
  private readonly solverWorkspaces: SolverWorkspaceService
  private readonly modelPool: WorkspaceModelPool
  private readonly pluginLoader = new RuntimePluginLoader()
  private readonly authManager: PlatformAuthManager
  private readonly contestManager: PlatformContestManager
  private onStateChanged: () => void = () => {}
  private onUnexpectedStop: (event: UnexpectedSolverStopEvent) => void = () => {}

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

  setUnexpectedStopListener(listener: (event: UnexpectedSolverStopEvent) => void) {
    this.onUnexpectedStop = listener
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

  getChallengeProgressState(challengeId: number): ChallengeSolverProgressState | undefined {
    const state = this.challengeProgress.get(challengeId)
    if (!state) {
      return undefined
    }

    return { ...state }
  }

  listChallengeProgressStates(): ChallengeSolverProgressState[] {
    return [...this.challengeProgress.values()].map((state) => ({ ...state }))
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

  restoreState(state: PersistedCTFRuntimeSolverHubState | undefined) {
    this.challengeProgress.clear()

    if (!state?.challengeProgress?.length) {
      return
    }

    for (const progress of state.challengeProgress) {
      if (!isPersistedProgressStatus(progress.status)) {
        continue
      }

      if (!Number.isFinite(progress.challengeId) || !progress.solverId) {
        continue
      }

      this.challengeProgress.set(progress.challengeId, {
        challengeId: progress.challengeId,
        solverId: progress.solverId,
        status: progress.status,
        flagAccepted: Boolean(progress.flagAccepted),
        writeUpReady: Boolean(progress.writeUpReady),
        blockedReason: progress.blockedReason,
      })
    }
  }

  isChallengeSolved(challengeId: number) {
    return this.challengeProgress.get(challengeId)?.status === "solved"
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
    const result = await this.withRuntimeContext(async (context) =>
      this.requirePlugin().submitFlagRaw({
        ...context,
        challengeId,
        flag,
      }),
    )

    if (result.accepted) {
      const binding = this.challengeSolvers.get(challengeId)
      const state = this.ensureChallengeProgressState(
        challengeId,
        binding?.solverId ?? `solver-${String(challengeId)}`,
      )
      state.flagAccepted = true
      state.writeUpReady = false
      state.status = "writeup_required"
      state.blockedReason = "WriteUp.md is required before challenge completion"
      this.notifyStateChanged()
    }

    return result
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
        requiresContainer: binding.detail?.requiresContainer,
        score: binding.challenge.score,
        solvedCount: binding.challenge.solvedCount,
      })),
      challengeProgress: [...this.challengeProgress.values()].map((state) => ({
        challengeId: state.challengeId,
        solverId: state.solverId,
        status: state.status,
        flagAccepted: state.flagAccepted,
        writeUpReady: state.writeUpReady,
        blockedReason: state.blockedReason,
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
      rootDir: managedSolver.rootDir,
    }

    this.challengeSolvers.set(challenge.id, binding)
    this.ensureChallengeProgressState(challenge.id, solverId)
    this.queue.registerSolver({
      solverId,
      solve: async (task) => this.solveWithBinding(binding, task),
      abortActiveTask: () => binding.solver.abort(),
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
    const progress = this.ensureChallengeProgressState(binding.challenge.id, binding.solverId)
    progress.blockedReason = undefined

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

      try {
        if (shouldContinueSolverTask(task.payload, binding.solver.state.messages.length > 0)) {
          await binding.solver.continue()
        } else {
          await binding.solver.prompt(buildSolverTaskPrompt(binding.challenge, task.payload))
        }
      } catch (error) {
        if (progress.status === "solved" || isAbortLikeError(error)) {
          throw error
        }

        this.onUnexpectedStop({
          challengeId: binding.challenge.id,
          solverId: binding.solverId,
          taskId: task.taskId,
          error,
        })
        await binding.solver.continue()
      }

      await this.completeAcceptedChallenge(binding, progress)

      if (!progress.flagAccepted && progress.status !== "solved") {
        progress.status = "idle"
      }
    } finally {
      modelLease.release()
      this.notifyStateChanged()
    }

    const output: SolverTaskResult["output"] = {
      challengeId: binding.challenge.id,
      solverId: binding.solverId,
      messageCount: binding.solver.state.messages.length,
      challengeStatus: progress.status,
    }

    return output
  }

  private ensureChallengeProgressState(challengeId: number, solverId: string) {
    const existing = this.challengeProgress.get(challengeId)
    if (existing) {
      if (existing.solverId !== solverId) {
        existing.solverId = solverId
      }

      return existing
    }

    const state: ChallengeSolverProgressState = {
      challengeId,
      solverId,
      status: "idle",
      flagAccepted: false,
      writeUpReady: false,
    }
    this.challengeProgress.set(challengeId, state)
    return state
  }

  private async completeAcceptedChallenge(
    binding: ChallengeSolverBinding,
    progress: ChallengeSolverProgressState,
  ) {
    if (!progress.flagAccepted) {
      return
    }

    if (await this.hasWriteUp(binding.rootDir)) {
      progress.status = "solved"
      progress.writeUpReady = true
      progress.blockedReason = undefined
      return
    }

    progress.status = "writeup_required"
    progress.writeUpReady = false
    progress.blockedReason = "WriteUp.md is required before challenge completion"

    await binding.solver.prompt(buildWriteUpPrompt(binding.challenge))

    if (await this.hasWriteUp(binding.rootDir)) {
      progress.status = "solved"
      progress.writeUpReady = true
      progress.blockedReason = undefined
      return
    }

    progress.status = "blocked"
    progress.blockedReason = "Solver submitted an accepted flag but WriteUp.md is still missing"
    throw new Error(progress.blockedReason)
  }

  private async hasWriteUp(solverRootDir: string) {
    try {
      await access(join(solverRootDir, "WriteUp.md"))
      return true
    } catch {
      return false
    }
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

function buildWriteUpPrompt(challenge: ChallengeSummary) {
  return [
    `Your flag submission for challenge [${challenge.id}] ${challenge.title} appears accepted.`,
    "Before finishing this task, create a file named WriteUp.md in the solver workspace root.",
    "The writeup must include a short exploit path, key evidence, and the final flag rationale.",
    "Once WriteUp.md is saved, continue with a short completion note.",
  ].join("\n")
}

function shouldContinueSolverTask(payload: unknown, hasMessageHistory: boolean) {
  if (!hasMessageHistory || !payload || typeof payload !== "object") {
    return false
  }

  const task = payload as { challenge?: unknown }
  if (typeof task.challenge !== "number" || !Number.isFinite(task.challenge)) {
    return false
  }

  const keys = Object.keys(payload)
  return keys.length === 1 && keys[0] === "challenge"
}

function isPersistedProgressStatus(
  status: PersistedCTFRuntimeChallengeProgress["status"],
): status is ChallengeProgressStatus {
  return (
    status === "idle" ||
    status === "writeup_required" ||
    status === "solved" ||
    status === "blocked"
  )
}

function isAbortLikeError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false
  }

  const message = (error as { message?: unknown }).message
  if (typeof message !== "string") {
    return false
  }

  return /abort|cancel/i.test(message)
}
