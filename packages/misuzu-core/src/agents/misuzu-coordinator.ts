import type { AgentMessage, AgentTool } from "@mariozechner/pi-agent-core"
import { Type, type Static } from "@sinclair/typebox"
import { dirname, join } from "node:path"
import type { Model } from "@mariozechner/pi-ai"
import { FeaturedAgent, type FeaturedAgentOptions } from "./misuzu-featured.ts"
import { Solver } from "./misuzu-solver.ts"
import { createBaseTools, createReadOnlyTools } from "../tools/index.ts"
import { bashTool } from "../tools/base/bash.ts"
import { dockerTools } from "../tools/misuzu/docker.ts"
import type { SchedulerUpdateMessage } from "../features/messages.ts"
import { loadAgentSkills } from "../features/skill.ts"
import { CompetitionPersistence, defaultWorkspacesRoot } from "../features/persistence.ts"
import {
  formatError,
  getModelId,
  inferLaunchRootFromWorkspaceDir,
  isAssistantMessage,
  isChallengeUpdateMessage,
  isFlagResultMessage,
} from "./coordinator/helpers.ts"
import { ModelPool, parseModelSlots, type ModelSlot } from "./coordinator/model-pool.ts"
import { buildCoordinatorSystemPrompt } from "./coordinator/prompt.ts"
import type {
  Challenge,
  CoordinatorOptions,
  NotificationSource,
  PersistedCoordinatorState,
  PersistedSolverState,
  QueuedChallenge,
  ResumeCoordinatorOptions,
  SolverNotification,
  SolverRunEndMeta,
} from "./coordinator/types.ts"

export { ModelPool }
export type { Challenge, CoordinatorOptions, ModelSlot, ResumeCoordinatorOptions }

export class Coordinator extends FeaturedAgent {
  readonly modelPool: ModelPool
  readonly workspaceRoot: string
  readonly persistence: CompetitionPersistence
  readonly solvers: Map<string, Solver> = new Map()
  private readonly resolveModel?: (modelId: string) => Model<any> | undefined
  private readonly solverRunEndMeta = new Map<string, SolverRunEndMeta>()
  private readonly dispatchingChallenges = new Set<string>()
  private isQueueDispatchRunning = false
  readonly challengeQueue: QueuedChallenge[] = []

  constructor(options: CoordinatorOptions & FeaturedAgentOptions = {}) {
    const cwd = options.cwd ?? process.cwd()
    const workspaceRoot = options.workspaceRoot ?? cwd
    const fallbackModelId = options.model ? getModelId(options.model) : undefined
    const configuredModels = options.models ?? (fallbackModelId ? [fallbackModelId] : [])
    const modelPool =
      options.modelPool ??
      new ModelPool(configuredModels, { maxConcurrencyPerModel: options.modelConcurrency })
    const persistence =
      options.persistence ??
      CompetitionPersistence.create(defaultWorkspacesRoot(workspaceRoot), {
        id: options.workspaceId,
        name: options.ctfPlatformUrl ?? "misuzu-coordinator",
        platformUrl: options.ctfPlatformUrl,
        modelPool: modelPool.toJSON().map((slot) => slot.model),
      })

    persistence.initializeCoordinatorEnvironment(
      [
        "# Coordinator Environment",
        "",
        "## Platform",
        `- url: ${options.ctfPlatformUrl ?? "unknown"}`,
        `- last checked at: ${new Date().toISOString()}`,
        "",
        "## Notes",
        "- Coordinator updates solver ENVIRONMENT.md files from this workspace.",
        "",
      ].join("\n"),
    )

    const skills = loadAgentSkills({
      role: "coordinator",
      launchDir: workspaceRoot,
      extraSkills: options.skills,
    })

    const tools = [...createReadOnlyTools(cwd), bashTool]

    const systemPrompt = buildCoordinatorSystemPrompt(options)

    super({
      ...options,
      cwd,
      skills,
      tools,
      sessionManager: persistence.coordinatorSession,
      initialState: {
        ...options.initialState,
        model: options.model,
        systemPrompt,
      },
    })

    this.modelPool = modelPool
    this.workspaceRoot = workspaceRoot
    this.persistence = persistence
    this.resolveModel =
      options.modelResolver ??
      (options.model
        ? (modelId: string) => {
            if (!fallbackModelId || modelId !== fallbackModelId) return undefined
            return options.model
          }
        : undefined)

    const builtInCoordinatorTools = [
      this.getCreateSolverTool(),
      this.getUpdateSolverEnvironmentTool(),
      this.getConfirmSolverFlagTool(),
    ]
    const existing = new Map(this.state.tools.map((tool) => [tool.name, tool]))
    for (const tool of builtInCoordinatorTools) {
      existing.set(tool.name, tool)
    }
    this.setTools(Array.from(existing.values()))

    this.subscribe((event) => {
      if (
        event.type === "message_end" ||
        event.type === "tool_execution_end" ||
        event.type === "agent_end"
      ) {
        this.persistCoordinatorState()
      }
    })

    this.persistCoordinatorState()
  }

  private appendUserMessage(content: string) {
    this.appendMessage({ role: "user", content, timestamp: Date.now() })
  }

  private appendSchedulerUpdate(update: Omit<SchedulerUpdateMessage, "role" | "timestamp">) {
    this.appendMessage({
      role: "schedulerUpdate",
      ...update,
      timestamp: Date.now(),
    })
  }

  private createSolverTools(challengeId: string, solverRoot: string) {
    return [
      ...createBaseTools(solverRoot),
      ...dockerTools,
      this.createSolverNotifyCoordinatorTool(challengeId),
      this.createSolverReportFlagTool(challengeId),
    ]
  }

  static resumeFromWorkspace(options: ResumeCoordinatorOptions): Coordinator {
    const { workspaceDir, autoContinueSolvers = true } = options
    const persistence = CompetitionPersistence.open(workspaceDir)
    const manifest = persistence.readManifest()
    const persistedState =
      persistence.loadCoordinatorState<PersistedCoordinatorState>() ??
      ({} as PersistedCoordinatorState)

    const persistedSlots = parseModelSlots(persistedState.modelPool)
    const fallbackModels = persistedSlots.map((slot) => slot.model)
    const restoredModels =
      Array.isArray(options.models) && options.models.length > 0
        ? options.models
        : manifest.modelPool.length > 0
          ? manifest.modelPool
          : fallbackModels

    const modelPool =
      persistedSlots.length > 0
        ? ModelPool.fromSlots(persistedSlots)
        : new ModelPool(restoredModels, {
            maxConcurrencyPerModel:
              Array.isArray(options.models) && options.models.length > 0
                ? options.modelConcurrency
                : undefined,
          })

    const workspaceRoot =
      options.workspaceRoot ??
      persistedState.workspaceRoot ??
      inferLaunchRootFromWorkspaceDir(workspaceDir)

    const coordinator = new Coordinator({
      cwd: options.cwd ?? workspaceRoot,
      workspaceRoot,
      ctfPlatformUrl: options.ctfPlatformUrl ?? manifest.platformUrl,
      models: restoredModels,
      model: options.model,
      modelResolver: options.modelResolver,
      initialState: options.initialState,
      skills: options.skills,
      convertToLlm: options.convertToLlm,
      transformContext: options.transformContext,
      modelPool,
      persistence,
    })

    const restoredMessages = persistence.coordinatorSession.buildContext()
    if (restoredMessages.length > 0) {
      coordinator.replaceMessages(restoredMessages)
    }

    coordinator.challengeQueue.length = 0
    if (Array.isArray(persistedState.challengeQueue)) {
      coordinator.challengeQueue.push(...persistedState.challengeQueue)
    }

    coordinator.restoreSolversFromPersistence(autoContinueSolvers)
    coordinator.persistCoordinatorState()

    return coordinator
  }

  getCreateSolverTool() {
    const solverParams = Type.Object({
      challengeId: Type.String({ description: "Challenge ID from the platform" }),
      challengeName: Type.String({ description: "Challenge name" }),
      category: Type.String({
        description: "Challenge category (crypto, pwn, web, forensics, reversing, misc)",
      }),
      description: Type.String({ description: "Challenge description" }),
      difficulty: Type.Optional(Type.Number({ description: "Estimated difficulty 1-5" })),
      files: Type.Optional(
        Type.Array(Type.String(), { description: "URLs to challenge attachments" }),
      ),
    })

    type CreateSolverParams = Static<typeof solverParams>
    const tool: AgentTool<typeof solverParams> = {
      name: "create_solver",
      label: "Create Solver",
      description:
        "Create a new solver agent for a challenge. " +
        "Automatically selects an idle model from the pool. " +
        "Queues the challenge if no models are available and initializes per-solver workspace files.",
      parameters: solverParams,
      execute: async (_toolCallId, params: CreateSolverParams) => {
        const modelId = this.modelPool.acquire(params.challengeId)
        if (!modelId) {
          this.challengeQueue.push(params)
          this.persistCoordinatorState()
          return {
            content: [
              {
                type: "text" as const,
                text: `No models available. Challenge "${params.challengeName}" queued (${this.challengeQueue.length} in queue).`,
              },
            ],
            details: { queued: true, queueLength: this.challengeQueue.length },
          }
        }

        const solverWorkspace = await this.persistence.ensureSolverWorkspace({
          solverId: params.challengeId,
          challengeName: params.challengeName,
          category: params.category,
          description: params.description,
          difficulty: params.difficulty,
          files: params.files,
          model: modelId,
          launchDir: this.workspaceRoot,
        })

        const solverModel = this.resolveModel?.(modelId) ?? this.state.model

        const solver = new Solver({
          solverId: params.challengeId,
          cwd: solverWorkspace.rootDir,
          challengeDescription: params.description,
          workspaceRoot: this.workspaceRoot,
          environmentFilePath: solverWorkspace.environmentPath,
          scriptsDir: solverWorkspace.scriptsDir,
          writeupPath: solverWorkspace.writeupPath,
          tools: this.createSolverTools(params.challengeId, solverWorkspace.rootDir),
          sessionManager: solverWorkspace.session,
          model: solverModel,
        })

        this.solvers.set(params.challengeId, solver)
        this.persistence.saveSolverState(params.challengeId, {
          solverId: params.challengeId,
          challengeName: params.challengeName,
          category: params.category,
          status: "solving",
          model: modelId,
          cwd: solverWorkspace.rootDir,
          environmentPath: solverWorkspace.environmentPath,
          scriptsDir: solverWorkspace.scriptsDir,
          writeupPath: solverWorkspace.writeupPath,
          updatedAt: new Date().toISOString(),
        })
        this.persistCoordinatorState()

        this.attachSolverLifecycle(params.challengeId, params.challengeName, solver)

        void solver
          .solve(
            [
              `Challenge: ${params.challengeName}`,
              `Category: ${params.category}`,
              `Environment file: ${solverWorkspace.environmentPath}`,
              `Polling script template: ${solverWorkspace.platformPollScriptPath}`,
              "Read ENVIRONMENT.md first, then solve the challenge.",
              "If current remote URL is expired/unreachable, call notify_coordinator(kind=environment_expired) and wait for coordinator URL refresh.",
            ].join("\n"),
          )
          .catch((error: unknown) => {
            this.persistence.saveSolverState(params.challengeId, {
              solverId: params.challengeId,
              challengeName: params.challengeName,
              status: "failed",
              error: formatError(error),
              updatedAt: new Date().toISOString(),
            })
            this.appendUserMessage(
              `Solver for "${params.challengeName}" failed: ${formatError(error)}`,
            )
            this.onSolverFinished(params.challengeId, "failed")
          })

        return {
          content: [
            {
              type: "text",
              text: `Solver started for "${params.challengeName}" on model ${modelId}. Workspace: ${solverWorkspace.rootDir}`,
            },
          ],
          details: {
            model: modelId,
            solverId: params.challengeId,
            workspace: solverWorkspace.rootDir,
          },
        }
      },
    }

    return tool
  }

  private restoreSolversFromPersistence(autoContinueSolvers: boolean) {
    const manifest = this.persistence.readManifest()
    const coordinatorState =
      this.persistence.loadCoordinatorState<PersistedCoordinatorState>() ??
      ({} as PersistedCoordinatorState)

    const solverIds = new Set<string>(manifest.solverIds)
    if (Array.isArray(coordinatorState.solvers)) {
      for (const solverId of coordinatorState.solvers) {
        solverIds.add(solverId)
      }
    }

    for (const solverId of solverIds) {
      const solverState = this.persistence.loadSolverState<PersistedSolverState>(solverId)
      if (!solverState) continue

      const status = solverState.status ?? "assigned"
      if (status === "solved" || status === "stopped") {
        continue
      }

      const environmentPath =
        solverState.environmentPath ?? this.persistence.getSolverEnvironmentPath(solverId)
      const solverRoot = solverState.cwd ?? dirname(environmentPath)
      const scriptsDir = solverState.scriptsDir ?? join(solverRoot, "scripts")
      const writeupPath = solverState.writeupPath ?? this.persistence.getSolverWriteupPath(solverId)
      const modelId = typeof solverState.model === "string" ? solverState.model : undefined
      const solverModel = modelId
        ? (this.resolveModel?.(modelId) ?? this.state.model)
        : this.state.model

      const solver = new Solver({
        solverId,
        cwd: solverRoot,
        workspaceRoot: this.workspaceRoot,
        challengeDescription: solverState.description,
        environmentFilePath: environmentPath,
        scriptsDir,
        writeupPath,
        tools: this.createSolverTools(solverId, solverRoot),
        sessionManager: this.persistence.getSolverSession(solverId),
        model: solverModel,
      })

      const context = this.persistence.getSolverSession(solverId).buildContext()
      if (context.length > 0) {
        solver.replaceMessages(context)
      }

      this.solvers.set(solverId, solver)
      this.attachSolverLifecycle(solverId, solverState.challengeName ?? solverId, solver)

      if (autoContinueSolvers) {
        solver.steer(
          [
            "Session resumed from local workspace.",
            "Re-check ENVIRONMENT.md and continue solving from current context.",
          ].join("\n"),
        )
        void solver.continue().catch(() => undefined)
      }
    }
  }

  private attachSolverLifecycle(challengeId: string, challengeName: string, solver: Solver) {
    solver.subscribe((event) => {
      if (event.type === "message_end" && isFlagResultMessage(event.message)) {
        this.appendUserMessage(`Solver for "${challengeName}" found a flag: ${event.message.flag}`)
        this.persistCoordinatorState()
      }

      if (event.type === "message_end" && isChallengeUpdateMessage(event.message)) {
        this.handleSolverChallengeUpdate(
          challengeId,
          challengeName,
          event.message.details,
          event.message.status,
        )
      }

      if (event.type === "turn_end" && isAssistantMessage(event.message)) {
        this.solverRunEndMeta.set(challengeId, {
          stopReason: event.message.stopReason,
          errorMessage: event.message.errorMessage,
        })
      }

      if (event.type === "agent_end") {
        this.handleSolverAgentEnd(challengeId, challengeName, event.messages)
      }
    })
  }

  private resolveSolverRunEndMeta(challengeId: string, messages: AgentMessage[]): SolverRunEndMeta {
    const fromTurnEnd = this.solverRunEndMeta.get(challengeId)
    if (fromTurnEnd) {
      return fromTurnEnd
    }

    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]
      if (isAssistantMessage(message)) {
        return {
          stopReason: message.stopReason,
          errorMessage: message.errorMessage,
        }
      }
    }

    return {
      stopReason: "error",
      errorMessage: "Solver ended without assistant stopReason metadata.",
    }
  }

  private handleSolverAgentEnd(
    challengeId: string,
    challengeName: string,
    messages: AgentMessage[],
  ) {
    const persisted = this.persistence.loadSolverState<PersistedSolverState>(challengeId)
    const meta = this.resolveSolverRunEndMeta(challengeId, messages)
    const timestamp = new Date().toISOString()

    this.solverRunEndMeta.delete(challengeId)

    if (persisted?.status === "solved") {
      this.onSolverFinished(challengeId, "solved")
      return
    }

    if (meta.stopReason === "error" || meta.stopReason === "aborted") {
      this.persistence.saveSolverState(challengeId, {
        ...persisted,
        solverId: challengeId,
        challengeName,
        status: "failed",
        lastAgentEndReason: meta.stopReason,
        lastAgentEndError: meta.errorMessage,
        lastAgentEndAt: timestamp,
        updatedAt: timestamp,
      })
      this.appendUserMessage(
        [
          `Solver for "${challengeName}" ended with ${meta.stopReason}.`,
          meta.errorMessage ? `Reason: ${meta.errorMessage}` : "No additional error details.",
          "Model slot released. Re-dispatch if needed.",
        ].join("\n"),
      )
      this.onSolverFinished(challengeId, "failed")
      return
    }

    this.persistence.saveSolverState(challengeId, {
      ...persisted,
      solverId: challengeId,
      challengeName,
      status: "solving",
      lastAgentEndReason: meta.stopReason,
      lastAgentEndError: meta.errorMessage,
      lastAgentEndAt: timestamp,
      updatedAt: timestamp,
    })

    const guidance =
      meta.stopReason === "length"
        ? "Context limit reached; send steer/follow-up and continue this solver."
        : "Solver run ended before flag confirmation; decide whether to steer/follow-up or adjust environment."

    this.appendUserMessage(
      [
        `Solver for "${challengeName}" run ended with ${meta.stopReason}.`,
        meta.errorMessage ? `Details: ${meta.errorMessage}` : "No error details reported.",
        guidance,
      ].join("\n"),
    )
    this.persistCoordinatorState()
  }

  private async dispatchQueuedChallenges() {
    if (this.isQueueDispatchRunning) {
      return
    }

    this.isQueueDispatchRunning = true

    try {
      const createSolverTool = this.getCreateSolverTool()

      while (this.challengeQueue.length > 0 && this.modelPool.available > 0) {
        const queueBefore = this.challengeQueue.length
        const next = this.challengeQueue.shift()
        if (!next) {
          break
        }

        if (
          this.dispatchingChallenges.has(next.challengeId) ||
          this.solvers.has(next.challengeId)
        ) {
          this.appendSchedulerUpdate({
            challengeId: next.challengeId,
            challengeName: next.challengeName,
            status: "skipped",
            reason: "already_active",
            queueBefore,
            queueAfter: this.challengeQueue.length,
          })
          continue
        }

        const persisted = this.persistence.loadSolverState<PersistedSolverState>(next.challengeId)
        if (persisted?.status === "solved" || persisted?.status === "failed") {
          this.appendSchedulerUpdate({
            challengeId: next.challengeId,
            challengeName: next.challengeName,
            status: "skipped",
            reason: `already_${persisted.status}`,
            queueBefore,
            queueAfter: this.challengeQueue.length,
          })
          continue
        }

        this.dispatchingChallenges.add(next.challengeId)

        try {
          const result = await createSolverTool.execute(`queue-dispatch-${Date.now()}`, next)
          const details = result.details as
            | { queued?: boolean; model?: string; queueLength?: number }
            | undefined

          const isRequeued = details?.queued === true
          this.appendSchedulerUpdate({
            challengeId: next.challengeId,
            challengeName: next.challengeName,
            status: isRequeued ? "requeued" : "started",
            reason: isRequeued ? "model_unavailable" : "slot_freed_auto_dispatch",
            queueBefore,
            queueAfter:
              typeof details?.queueLength === "number"
                ? details.queueLength
                : this.challengeQueue.length,
            model: typeof details?.model === "string" ? details.model : undefined,
          })

          if (isRequeued) {
            break
          }
        } catch (error: unknown) {
          this.persistence.saveSolverState(next.challengeId, {
            solverId: next.challengeId,
            challengeName: next.challengeName,
            status: "failed",
            error: formatError(error),
            updatedAt: new Date().toISOString(),
          })
          this.appendSchedulerUpdate({
            challengeId: next.challengeId,
            challengeName: next.challengeName,
            status: "failed",
            reason: formatError(error),
            queueBefore,
            queueAfter: this.challengeQueue.length,
          })
          this.appendUserMessage(
            `Failed to dispatch queued challenge "${next.challengeName}": ${formatError(error)}`,
          )
        } finally {
          this.dispatchingChallenges.delete(next.challengeId)
        }
      }
    } finally {
      this.isQueueDispatchRunning = false
      this.persistCoordinatorState()
    }
  }

  getUpdateSolverEnvironmentTool() {
    const schema = Type.Object({
      challengeId: Type.String({ description: "Solver challenge ID" }),
      updateType: Type.Union([
        Type.Literal("environment_url"),
        Type.Literal("hint"),
        Type.Literal("platform_notice"),
      ]),
      content: Type.String({ description: "Update content or hint text" }),
      url: Type.Optional(
        Type.String({ description: "Latest environment URL (for environment_url)" }),
      ),
      expiresAt: Type.Optional(
        Type.String({
          description: "Expiration time text (for environment_url), e.g. 2026-03-27T12:00:00Z",
        }),
      ),
    })

    type UpdateSolverEnvironmentParams = Static<typeof schema>
    const tool: AgentTool<typeof schema> = {
      name: "update_solver_environment",
      label: "Update Solver Environment",
      description:
        "Update solver ENVIRONMENT.md with refreshed URL, hint, or platform notice and notify the solver.",
      parameters: schema,
      execute: async (_toolCallId, params: UpdateSolverEnvironmentParams) => {
        const result = await this.applySolverNotification(
          params.challengeId,
          {
            kind: params.updateType,
            content: params.content,
            url: params.url,
            expiresAt: params.expiresAt,
          },
          "coordinator",
        )

        return {
          content: [
            {
              type: "text" as const,
              text: result.message,
            },
          ],
          details: {
            challengeId: params.challengeId,
            environmentPath: this.persistence.getSolverEnvironmentPath(params.challengeId),
            verified: result.verified,
            applied: result.applied,
            verificationStatus: result.status,
          },
        }
      },
    }

    return tool
  }

  getConfirmSolverFlagTool() {
    const schema = Type.Object({
      challengeId: Type.String({ description: "Solver challenge ID" }),
      flag: Type.String({ description: "Flag string that was submitted" }),
      correct: Type.Boolean({ description: "Whether platform confirmed this flag" }),
      message: Type.Optional(Type.String({ description: "Optional confirmation details" })),
    })

    type ConfirmSolverFlagParams = Static<typeof schema>
    const tool: AgentTool<typeof schema> = {
      name: "confirm_solver_flag",
      label: "Confirm Solver Flag",
      description:
        "Confirm a solver-submitted flag result. If correct, trigger writeup generation in Writeups.md.",
      parameters: schema,
      execute: async (_toolCallId, params: ConfirmSolverFlagParams) => {
        this.confirmSolverFlag(params.challengeId, params.flag, params.correct, params.message)

        return {
          content: [
            {
              type: "text" as const,
              text: params.correct
                ? `Flag confirmed for ${params.challengeId}; solver instructed to write Writeups.md.`
                : `Flag rejected for ${params.challengeId}; solver was notified.`,
            },
          ],
          details: {
            challengeId: params.challengeId,
            correct: params.correct,
            writeupPath: this.persistence.getSolverWriteupPath(params.challengeId),
          },
        }
      },
    }

    return tool
  }

  confirmSolverFlag(challengeId: string, flag: string, correct: boolean, message?: string) {
    const solver = this.solvers.get(challengeId)
    const timestamp = new Date().toISOString()

    if (correct) {
      this.persistence.appendSolverEnvironmentNote(
        challengeId,
        `Coordinator confirmed flag correctness: ${flag}`,
      )
      this.persistence.appendSolverWriteup(
        challengeId,
        [
          `## Flag Confirmed (${timestamp})`,
          `- flag: ${flag}`,
          message ? `- notes: ${message}` : "- notes: (none)",
          "",
          "### Repro Steps",
          "1. Describe exact steps and commands used.",
          "2. Reference scripts from scripts/.",
          "3. Include verification output.",
        ].join("\n"),
      )
      this.persistence.saveSolverState(challengeId, {
        solverId: challengeId,
        status: "solved",
        flag,
        message,
        updatedAt: timestamp,
      })
      solver?.notifyFlagConfirmed(message)
    } else {
      this.persistence.appendSolverEnvironmentNote(
        challengeId,
        `Coordinator rejected submitted flag: ${flag}`,
      )
      this.persistence.saveSolverState(challengeId, {
        solverId: challengeId,
        status: "solving",
        lastRejectedFlag: flag,
        flag,
        message,
        updatedAt: timestamp,
      })
      solver?.steer(
        [
          `Coordinator rejected submitted flag: ${flag}`,
          message ? `Reason: ${message}` : "No rejection reason provided.",
          "Continue solving and update scripts as needed.",
        ].join("\n"),
      )
    }

    this.persistCoordinatorState()
  }

  private createSolverNotifyCoordinatorTool(challengeId: string) {
    const schema = Type.Object({
      kind: Type.Union([
        Type.Literal("environment_expired"),
        Type.Literal("hint"),
        Type.Literal("platform_notice"),
      ]),
      content: Type.String({ description: "Notification details from solver" }),
    })

    type NotifyCoordinatorParams = Static<typeof schema>
    const tool: AgentTool<typeof schema> = {
      name: "notify_coordinator",
      label: "Notify Coordinator",
      description:
        "Notify coordinator about environment expiry, hints, or platform notices so ENVIRONMENT.md can be updated.",
      parameters: schema,
      execute: async (_toolCallId, params: NotifyCoordinatorParams) => {
        const result = await this.applySolverNotification(challengeId, params, "solver")

        return {
          content: [
            {
              type: "text" as const,
              text: result.message,
            },
          ],
          details: {
            challengeId,
            environmentPath: this.persistence.getSolverEnvironmentPath(challengeId),
            kind: params.kind,
            verified: result.verified,
            applied: result.applied,
            verificationStatus: result.status,
          },
        }
      },
    }

    return tool
  }

  private createSolverReportFlagTool(challengeId: string) {
    const schema = Type.Object({
      flag: Type.String({ description: "Candidate flag found by solver" }),
      details: Type.Optional(
        Type.String({ description: "Optional notes about exploit path or confidence" }),
      ),
    })

    type ReportFlagParams = Static<typeof schema>
    const tool: AgentTool<typeof schema> = {
      name: "report_flag",
      label: "Report Flag",
      description:
        "Report candidate flag to coordinator for platform submission and correctness confirmation.",
      parameters: schema,
      execute: async (_toolCallId, params: ReportFlagParams) => {
        const now = Date.now()

        this.appendMessage({
          role: "flagResult",
          challengeId,
          flag: params.flag,
          correct: false,
          message:
            params.details ??
            `Solver submitted candidate flag for ${challengeId}. Please submit and confirm via confirm_solver_flag.`,
          timestamp: now,
        })

        this.persistence.saveSolverState(challengeId, {
          solverId: challengeId,
          status: "solving",
          latestSubmittedFlag: params.flag,
          details: params.details,
          updatedAt: new Date(now).toISOString(),
        })
        this.persistCoordinatorState()

        return {
          content: [
            {
              type: "text" as const,
              text: `Flag submitted to coordinator: ${params.flag}`,
            },
          ],
          details: {
            challengeId,
            flag: params.flag,
          },
        }
      },
    }

    return tool
  }

  private async applySolverNotification(
    challengeId: string,
    notification: SolverNotification,
    source: NotificationSource,
  ): Promise<{ applied: boolean; verified: boolean; status?: number; message: string }> {
    const note = `[${notification.kind}] ${notification.content}`
    let applied = true
    let verified = false
    let status: number | undefined
    let message = `Coordinator notified for ${challengeId}.`

    if (source === "solver" && notification.kind === "environment_url") {
      applied = false
      message =
        "Solver-provided environment_url was ignored. Coordinator must refresh URL via browser and call update_solver_environment."
      this.persistence.appendSolverEnvironmentNote(
        challengeId,
        `${note} (ignored: manual coordinator browser refresh required)`,
      )
      this.appendUserMessage(
        [
          `Solver ${challengeId} reported a candidate environment URL, but runtime policy requires coordinator refresh.`,
          "Open the platform challenge page in browser, click the refresh/start button, then call update_solver_environment.",
          `ENVIRONMENT.md: ${this.persistence.getSolverEnvironmentPath(challengeId)}`,
        ].join("\n"),
      )
      this.persistCoordinatorState()
      return { applied, verified, status, message }
    }

    if (notification.kind === "environment_url" && notification.url) {
      const verification = await this.verifyEnvironmentUrl(notification.url)
      verified = verification.ok
      status = verification.status

      if (verification.ok) {
        this.persistence.updateSolverEnvironmentUrl(
          challengeId,
          notification.url,
          notification.expiresAt,
        )
        this.persistence.appendSolverEnvironmentNote(challengeId, note)
        message = `Environment URL verified and updated for ${challengeId}.`
      } else {
        applied = false
        this.persistence.appendSolverEnvironmentNote(
          challengeId,
          `${note} (rejected: ${verification.message})`,
        )
        this.appendUserMessage(
          [
            `Environment URL update failed for solver ${challengeId}.`,
            `Candidate URL: ${notification.url}`,
            `Reason: ${verification.message}`,
            `Please fetch a valid URL and retry update_solver_environment.`,
          ].join("\n"),
        )
        message = `Environment URL verification failed for ${challengeId}: ${verification.message}`
      }
    } else {
      this.persistence.appendSolverEnvironmentNote(challengeId, note)
    }

    if (notification.kind === "environment_expired") {
      this.appendUserMessage(
        [
          `Solver ${challengeId} reported environment expired.`,
          "Use browser workflow to fetch a fresh environment URL and then call update_solver_environment.",
          `ENVIRONMENT.md: ${this.persistence.getSolverEnvironmentPath(challengeId)}`,
        ].join("\n"),
      )
    }

    const solver = this.solvers.get(challengeId)
    if (
      source === "coordinator" &&
      solver &&
      applied &&
      (notification.kind === "environment_url" || notification.kind === "hint")
    ) {
      solver.refreshEnvironmentContext(`notification: ${notification.kind}`)
    }

    this.persistCoordinatorState()
    return { applied, verified, status, message }
  }

  private async verifyEnvironmentUrl(
    url: string,
  ): Promise<{ ok: boolean; status?: number; message: string }> {
    const attempts: Array<{ method: "HEAD" | "GET"; timeoutMs: number }> = [
      { method: "HEAD", timeoutMs: 8000 },
      { method: "GET", timeoutMs: 10000 },
    ]

    for (const attempt of attempts) {
      try {
        const response = await fetch(url, {
          method: attempt.method,
          redirect: "follow",
          signal: AbortSignal.timeout(attempt.timeoutMs),
        })

        if (response.ok) {
          return {
            ok: true,
            status: response.status,
            message: `HTTP ${response.status} (${attempt.method})`,
          }
        }

        if (attempt.method === "GET") {
          return {
            ok: false,
            status: response.status,
            message: `HTTP ${response.status}`,
          }
        }
      } catch (error) {
        if (attempt.method === "GET") {
          return {
            ok: false,
            message: formatError(error),
          }
        }
      }
    }

    return {
      ok: false,
      message: "Unable to verify URL",
    }
  }

  private handleSolverChallengeUpdate(
    challengeId: string,
    challengeName: string,
    details: string,
    status: string,
  ) {
    this.persistence.appendSolverEnvironmentNote(
      challengeId,
      `solver challengeUpdate(${status}) from ${challengeName}: ${details}`,
    )
    this.persistence.saveSolverState(challengeId, {
      solverId: challengeId,
      status,
      details,
      updatedAt: new Date().toISOString(),
    })
    this.persistCoordinatorState()
  }

  addModelToPool(modelId: string, concurrency = 1) {
    const result = this.modelPool.addModel(modelId, concurrency)
    this.persistModelPoolManifest()
    this.persistCoordinatorState()
    void this.dispatchQueuedChallenges()
    return result
  }

  setModelPoolConcurrency(modelId: string, concurrency: number) {
    const result = this.modelPool.setModelConcurrency(modelId, concurrency)
    this.persistModelPoolManifest()
    this.persistCoordinatorState()
    void this.dispatchQueuedChallenges()
    return result
  }

  private persistCoordinatorState() {
    this.persistence.saveCoordinatorState({
      workspaceRoot: this.workspaceRoot,
      modelPool: this.modelPool.toJSON(),
      solvers: Array.from(this.solvers.keys()),
      challengeQueue: this.challengeQueue,
      updatedAt: new Date().toISOString(),
    })
  }

  private persistModelPoolManifest() {
    this.persistence.updateManifest({
      modelPool: this.modelPool.toJSON().map((slot) => slot.model),
    })
  }

  private onSolverFinished(solverId: string, status: "solved" | "failed") {
    if (!this.solvers.has(solverId)) {
      return
    }

    const current = this.persistence.loadSolverState<PersistedSolverState>(solverId)

    this.modelPool.release(solverId)
    this.solvers.delete(solverId)
    this.solverRunEndMeta.delete(solverId)

    this.persistence.saveSolverState(solverId, {
      ...current,
      solverId,
      status,
      updatedAt: new Date().toISOString(),
    })

    void this.dispatchQueuedChallenges()

    this.persistCoordinatorState()
  }
}
