import { Type } from "@sinclair/typebox"
import { dirname, join, resolve } from "node:path"
import type { Model } from "@mariozechner/pi-ai"
import { FeaturedAgent, type FeaturedAgentOptions } from "./misuzu-featured.ts"
import { Solver } from "./misuzu-solver.ts"
import { createBaseTools, createReadOnlyTools } from "../tools/index.ts"
import { bashTool } from "../tools/base/bash.ts"
import { dockerTools } from "../tools/misuzu/docker.ts"
import type { FlagResultMessage } from "../features/messages.ts"
import { loadAgentSkills } from "../features/skill.ts"
import {
  CompetitionPersistence,
  defaultWorkspacesRoot,
  type JsonObject,
} from "../features/persistence.ts"

export interface ModelSlot {
  model: string
  status: "idle" | "busy"
  solverId?: string
}

export interface ModelPoolOptions {
  maxConcurrencyPerModel?: number
}

function getModelId(model: Model<any>): string {
  const candidate = (model as { id?: unknown }).id
  if (typeof candidate === "string" && candidate.trim().length > 0) {
    return candidate
  }
  return "model"
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function inferLaunchRootFromWorkspaceDir(workspaceDir: string): string {
  const resolvedWorkspaceDir = resolve(workspaceDir)
  const workspacesDir = dirname(resolvedWorkspaceDir)
  const dotMisuzuDir = dirname(workspacesDir)
  return dirname(dotMisuzuDir)
}

function parseModelSlots(value: unknown): ModelSlot[] {
  if (!Array.isArray(value)) return []

  const slots: ModelSlot[] = []
  for (const item of value) {
    if (!item || typeof item !== "object") continue
    const candidate = item as Record<string, unknown>
    if (typeof candidate.model !== "string") continue
    if (candidate.status !== "idle" && candidate.status !== "busy") continue

    slots.push({
      model: candidate.model,
      status: candidate.status,
      solverId: typeof candidate.solverId === "string" ? candidate.solverId : undefined,
    })
  }

  return slots
}

export class ModelPool {
  private slots: ModelSlot[]

  constructor(models: string[], options: ModelPoolOptions = {}) {
    const perModel = Math.max(1, Math.floor(options.maxConcurrencyPerModel ?? 1))
    this.slots = models.flatMap((model) =>
      Array.from({ length: perModel }, () => ({ model, status: "idle" as const })),
    )
  }

  static fromSlots(slots: ModelSlot[]): ModelPool {
    const pool = new ModelPool([])
    pool.slots = slots.map((slot) => ({ ...slot }))
    return pool
  }

  acquire(solverId: string): string | null {
    const slot = this.slots.find((s) => s.status === "idle")
    if (!slot) return null
    slot.status = "busy"
    slot.solverId = solverId
    return slot.model
  }

  release(solverId: string): void {
    const slot = this.slots.find((s) => s.solverId === solverId)
    if (slot) {
      slot.status = "idle"
      slot.solverId = undefined
    }
  }

  get available(): number {
    return this.slots.filter((s) => s.status === "idle").length
  }

  toJSON(): ModelSlot[] {
    return [...this.slots]
  }
}

export interface CoordinatorOptions {
  cwd?: string
  workspaceRoot?: string
  workspaceId?: string
  ctfPlatformUrl?: string
  models?: string[]
  modelConcurrency?: number
  model?: Model<any>
  modelResolver?: (modelId: string) => Model<any> | undefined
  modelPool?: ModelPool
  persistence?: CompetitionPersistence
}

export interface Challenge {
  id: string
  name: string
  category: string
  description: string
  difficulty?: number
  files?: string[]
  points?: number
}

type SolverNotificationKind = "environment_expired" | "environment_url" | "hint" | "platform_notice"

interface SolverNotification {
  kind: SolverNotificationKind
  content: string
  url?: string
  expiresAt?: string
}

interface SolverReportedFlag {
  flag: string
  details?: string
}

interface PersistedCoordinatorState extends JsonObject {
  workspaceRoot?: string
  modelPool?: ModelSlot[]
  solvers?: string[]
  challengeQueue?: Array<{
    challengeId: string
    challengeName: string
    category: string
    description: string
    difficulty?: number
    files?: string[]
  }>
}

interface PersistedSolverState extends JsonObject {
  solverId?: string
  challengeName?: string
  category?: string
  description?: string
  status?: string
  model?: string
  cwd?: string
  environmentPath?: string
  scriptsDir?: string
  writeupPath?: string
}

export interface ResumeCoordinatorOptions {
  workspaceDir: string
  autoContinueSolvers?: boolean
  cwd?: CoordinatorOptions["cwd"]
  workspaceRoot?: CoordinatorOptions["workspaceRoot"]
  ctfPlatformUrl?: CoordinatorOptions["ctfPlatformUrl"]
  models?: CoordinatorOptions["models"]
  modelConcurrency?: CoordinatorOptions["modelConcurrency"]
  model?: CoordinatorOptions["model"]
  modelResolver?: CoordinatorOptions["modelResolver"]
  initialState?: FeaturedAgentOptions["initialState"]
  skills?: FeaturedAgentOptions["skills"]
  convertToLlm?: FeaturedAgentOptions["convertToLlm"]
  transformContext?: FeaturedAgentOptions["transformContext"]
}

export class Coordinator extends FeaturedAgent {
  readonly modelPool: ModelPool
  readonly workspaceRoot: string
  readonly persistence: CompetitionPersistence
  readonly solvers: Map<string, Solver> = new Map()
  private readonly resolveModel?: (modelId: string) => Model<any> | undefined
  readonly challengeQueue: Array<{
    challengeId: string
    challengeName: string
    category: string
    description: string
    difficulty?: number
    files?: string[]
  }> = []

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
      existing.set(tool.name, tool as any)
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

    return {
      name: "create_solver",
      label: "Create Solver",
      description:
        "Create a new solver agent for a challenge. " +
        "Automatically selects an idle model from the pool. " +
        "Queues the challenge if no models are available and initializes per-solver workspace files.",
      parameters: solverParams,
      execute: async (_toolCallId: string, rawParams: unknown) => {
        const params = rawParams as {
          challengeId: string
          challengeName: string
          category: string
          description: string
          difficulty?: number
          files?: string[]
        }
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

        const solverTools = [
          ...createBaseTools(solverWorkspace.rootDir),
          ...dockerTools,
          this.createSolverNotifyCoordinatorTool(params.challengeId),
          this.createSolverReportFlagTool(params.challengeId),
        ]

        const solver = new Solver({
          solverId: params.challengeId,
          cwd: solverWorkspace.rootDir,
          challengeDescription: params.description,
          workspaceRoot: this.workspaceRoot,
          environmentFilePath: solverWorkspace.environmentPath,
          scriptsDir: solverWorkspace.scriptsDir,
          writeupPath: solverWorkspace.writeupPath,
          tools: solverTools,
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
            this.appendMessage({
              role: "user",
              content: `Solver for "${params.challengeName}" failed: ${formatError(error)}`,
              timestamp: Date.now(),
            } as any)
            this.persistCoordinatorState()
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
        tools: [
          ...createBaseTools(solverRoot),
          ...dockerTools,
          this.createSolverNotifyCoordinatorTool(solverId),
          this.createSolverReportFlagTool(solverId),
        ],
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
      if (event.type === "message_end" && event.message.role === "flagResult") {
        this.appendMessage({
          role: "user" as const,
          content: `Solver for "${challengeName}" found a flag: ${(event.message as unknown as FlagResultMessage).flag}`,
          timestamp: Date.now(),
        } as any)
        this.persistCoordinatorState()
      }

      if (event.type === "message_end" && event.message.role === "challengeUpdate") {
        this.handleSolverChallengeUpdate(
          challengeId,
          challengeName,
          String((event.message as any).details ?? ""),
          String((event.message as any).status ?? "solving"),
        )
      }

      if (event.type === "agent_end") {
        this.persistence.saveSolverState(challengeId, {
          solverId: challengeId,
          challengeName,
          status: "stopped",
          updatedAt: new Date().toISOString(),
        })
        this.onSolverFinished(challengeId)
      }
    })
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

    return {
      name: "update_solver_environment",
      label: "Update Solver Environment",
      description:
        "Update solver ENVIRONMENT.md with refreshed URL, hint, or platform notice and notify the solver.",
      parameters: schema,
      execute: async (_toolCallId: string, rawParams: unknown) => {
        const params = rawParams as {
          challengeId: string
          updateType: SolverNotificationKind
          content: string
          url?: string
          expiresAt?: string
        }

        const result = await this.applySolverNotification(params.challengeId, {
          kind: params.updateType,
          content: params.content,
          url: params.url,
          expiresAt: params.expiresAt,
        })

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
  }

  getConfirmSolverFlagTool() {
    const schema = Type.Object({
      challengeId: Type.String({ description: "Solver challenge ID" }),
      flag: Type.String({ description: "Flag string that was submitted" }),
      correct: Type.Boolean({ description: "Whether platform confirmed this flag" }),
      message: Type.Optional(Type.String({ description: "Optional confirmation details" })),
    })

    return {
      name: "confirm_solver_flag",
      label: "Confirm Solver Flag",
      description:
        "Confirm a solver-submitted flag result. If correct, trigger writeup generation in Writeups.md.",
      parameters: schema,
      execute: async (_toolCallId: string, rawParams: unknown) => {
        const params = rawParams as {
          challengeId: string
          flag: string
          correct: boolean
          message?: string
        }

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
        Type.Literal("environment_url"),
        Type.Literal("hint"),
        Type.Literal("platform_notice"),
      ]),
      content: Type.String({ description: "Notification details from solver" }),
      url: Type.Optional(Type.String({ description: "Latest environment URL if available" })),
      expiresAt: Type.Optional(Type.String({ description: "Expiration timestamp text" })),
    })

    return {
      name: "notify_coordinator",
      label: "Notify Coordinator",
      description:
        "Notify coordinator about environment expiry, refreshed URL, hints, or platform notices so ENVIRONMENT.md can be updated.",
      parameters: schema,
      execute: async (_toolCallId: string, rawParams: unknown) => {
        const params = rawParams as SolverNotification
        const result = await this.applySolverNotification(challengeId, params)

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
  }

  private createSolverReportFlagTool(challengeId: string) {
    const schema = Type.Object({
      flag: Type.String({ description: "Candidate flag found by solver" }),
      details: Type.Optional(
        Type.String({ description: "Optional notes about exploit path or confidence" }),
      ),
    })

    return {
      name: "report_flag",
      label: "Report Flag",
      description:
        "Report candidate flag to coordinator for platform submission and correctness confirmation.",
      parameters: schema,
      execute: async (_toolCallId: string, rawParams: unknown) => {
        const params = rawParams as SolverReportedFlag
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
        } as any)

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
  }

  private async applySolverNotification(
    challengeId: string,
    notification: SolverNotification,
  ): Promise<{ applied: boolean; verified: boolean; status?: number; message: string }> {
    const note = `[${notification.kind}] ${notification.content}`
    let applied = true
    let verified = false
    let status: number | undefined
    let message = `Coordinator notified for ${challengeId}.`

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
        this.appendMessage({
          role: "user",
          content: [
            `Environment URL update failed for solver ${challengeId}.`,
            `Candidate URL: ${notification.url}`,
            `Reason: ${verification.message}`,
            `Please fetch a valid URL and retry update_solver_environment.`,
          ].join("\n"),
          timestamp: Date.now(),
        } as any)
        message = `Environment URL verification failed for ${challengeId}: ${verification.message}`
      }
    } else {
      this.persistence.appendSolverEnvironmentNote(challengeId, note)
    }

    if (notification.kind === "environment_expired") {
      this.appendMessage({
        role: "user",
        content: [
          `Solver ${challengeId} reported environment expired.`,
          "Use browser workflow to fetch a fresh environment URL and then call update_solver_environment.",
          `ENVIRONMENT.md: ${this.persistence.getSolverEnvironmentPath(challengeId)}`,
        ].join("\n"),
        timestamp: Date.now(),
      } as any)
    }

    const solver = this.solvers.get(challengeId)
    if (
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

  private persistCoordinatorState() {
    this.persistence.saveCoordinatorState({
      workspaceRoot: this.workspaceRoot,
      modelPool: this.modelPool.toJSON(),
      solvers: Array.from(this.solvers.keys()),
      challengeQueue: this.challengeQueue,
      updatedAt: new Date().toISOString(),
    })
  }

  private onSolverFinished(solverId: string) {
    if (!this.solvers.has(solverId)) {
      return
    }

    this.modelPool.release(solverId)
    this.solvers.delete(solverId)
    this.persistence.saveSolverState(solverId, {
      solverId,
      status: "stopped",
      updatedAt: new Date().toISOString(),
    })

    if (this.challengeQueue.length > 0 && this.modelPool.available > 0) {
      const next = this.challengeQueue.shift()!
      // Queue follow-up to create next solver
      this.appendMessage({
        role: "user",
        content: `Model freed. Create a solver for queued challenge: ${next.challengeName} (ID: ${next.challengeId})`,
        timestamp: Date.now(),
      } as any)
    }

    this.persistCoordinatorState()
  }
}

function buildCoordinatorSystemPrompt(_options: CoordinatorOptions) {
  return `You are a CTF team coordinator. Your job is to:

1. Navigate to the CTF platform and fetch all challenges
   with their titles, descriptions, attachments, categories, remote environment URLs and so on
2. Estimate difficulty and sort challenges (easiest first)
3. Assign Solver agents to challenges using create_solver
   - Each solver needs one model from the pool
   - If no models are available, challenges are queued automatically
4. Maintain per-solver ENVIRONMENT.md with latest URLs/hints/notices
5. When a solver reports a flag, submit it to the platform and confirm using confirm_solver_flag
6. Forward platform announcements to active solvers
7. Notify the user of progress

Workflow:
- Use browser to navigate and extract challenge information
- Call create_solver for each challenge (easiest first)
- The system handles model allocation and queuing automatically
- Use bash to submit flags when solvers report them
- Use update_solver_environment to keep ENVIRONMENT.md synchronized
- Remote environment may have quantitative limits, do not try to launch a wnv again when being informed reached the limit.`
}
