import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import type { AgentEvent, AgentMessage, AgentTool } from "@mariozechner/pi-agent-core"
import { Coordinator, defaultWorkspacesRoot, type Solver } from "misuzu-core"
import type {
  RuntimeCommandRequest,
  RuntimeCommandRequestFor,
  RuntimeCommandResponse,
  RuntimeEventEnvelope,
  RuntimeJsonValue,
  RuntimeSnapshot,
  SolverSnapshot,
  WorkspaceSummary,
} from "./protocol.ts"
import type { RuntimeHost } from "./runtime-host.ts"

export interface MisuzuRuntimeHostOptions {
  workspacesRoot?: string
  replayLimit?: number
  startupEventType?: "runtime.started" | "runtime.resumed"
  ensureModelAvailable?: (modelId: string) => Promise<void> | void
  onServerRestartRequested?: () => Promise<void> | void
}

interface WorkspaceManifestRecord {
  id?: string
  platformUrl?: string
  updatedAt?: string
}

interface PersistedSolverState {
  challengeName?: string
  status?: string
  model?: string
  updatedAt?: string
}

type CoordinatorToolName = "create_solver" | "update_solver_environment" | "confirm_solver_flag"

export class MisuzuRuntimeHost implements RuntimeHost {
  private readonly listeners = new Set<(event: RuntimeEventEnvelope) => void>()
  private readonly events: RuntimeEventEnvelope[] = []
  private readonly solverSubscriptions = new Map<string, () => void>()
  private readonly replayLimit: number
  private readonly workspacesRoot: string
  private readonly ensureModelAvailable?: (modelId: string) => Promise<void> | void
  private readonly onServerRestartRequested?: () => Promise<void> | void
  private coordinatorSubscription?: () => void
  private seq = 0
  private commandQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly coordinator: Coordinator,
    options: MisuzuRuntimeHostOptions = {},
  ) {
    this.workspacesRoot = resolve(
      options.workspacesRoot ?? defaultWorkspacesRoot(this.coordinator.workspaceRoot),
    )
    this.replayLimit = Math.max(100, options.replayLimit ?? 1000)
    this.ensureModelAvailable = options.ensureModelAvailable
    this.onServerRestartRequested = options.onServerRestartRequested

    this.coordinatorSubscription = this.coordinator.subscribe((event) => {
      this.handleCoordinatorEvent(event)
      this.syncSolverSubscriptions()
    })

    this.syncSolverSubscriptions()
    this.publish("server", options.startupEventType ?? "runtime.started", {
      workspaceId: this.tryWorkspaceId() ?? "unavailable",
      workspaceRoot: this.coordinator.workspaceRoot,
    })
  }

  close() {
    if (this.coordinatorSubscription) {
      this.coordinatorSubscription()
      this.coordinatorSubscription = undefined
    }

    for (const unsubscribe of this.solverSubscriptions.values()) {
      unsubscribe()
    }
    this.solverSubscriptions.clear()
    this.listeners.clear()
  }

  getSnapshot(): RuntimeSnapshot {
    const slots = this.coordinator.modelPool.toJSON()
    const workspaceId = this.tryWorkspaceId()
    const solvers: SolverSnapshot[] = []

    for (const [solverId, solver] of this.coordinator.solvers.entries()) {
      const persisted = this.readPersistedSolverState(solverId)
      solvers.push({
        solverId,
        challengeName: persisted.challengeName,
        status: normalizeSolverStatus(persisted.status),
        model: persisted.model,
        messageCount: solver.state.messages.length,
        isStreaming: solver.state.isStreaming,
        updatedAt: persisted.updatedAt,
      })
    }

    solvers.sort((a, b) => a.solverId.localeCompare(b.solverId))

    return {
      protocolVersion: 1,
      workspaceId,
      workspaceRoot: this.coordinator.workspaceRoot,
      modelPool: {
        slots,
        available: this.coordinator.modelPool.available,
        total: slots.length,
      },
      challengeQueue: this.coordinator.challengeQueue.map((challenge) => ({
        challengeId: challenge.challengeId,
        challengeName: challenge.challengeName,
        category: challenge.category,
        difficulty: challenge.difficulty,
      })),
      solvers,
      generatedAt: new Date().toISOString(),
      lastSeq: this.seq,
    }
  }

  getEventsSince(seq?: number): RuntimeEventEnvelope[] {
    if (typeof seq !== "number") {
      return [...this.events]
    }
    return this.events.filter((event) => event.seq > seq)
  }

  subscribeEvents(listener: (event: RuntimeEventEnvelope) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  executeCommand(request: RuntimeCommandRequest): Promise<RuntimeCommandResponse> {
    return this.enqueueCommand(() => this.executeCommandInternal(request))
  }

  listWorkspaces(): WorkspaceSummary[] {
    if (!existsSync(this.workspacesRoot)) return []

    const summaries: WorkspaceSummary[] = []
    const entries = readdirSync(this.workspacesRoot, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const workspaceDir = join(this.workspacesRoot, entry.name)
      const manifestPath = join(workspaceDir, "manifest.json")
      if (!existsSync(manifestPath)) continue

      try {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as WorkspaceManifestRecord
        summaries.push({
          workspaceId: manifest.id ?? entry.name,
          workspaceDir,
          platformUrl: manifest.platformUrl,
          updatedAt: manifest.updatedAt,
        })
      } catch {
        // Ignore malformed manifests; listing is best-effort.
      }
    }

    summaries.sort((a, b) => {
      if (!a.updatedAt && !b.updatedAt) return a.workspaceId.localeCompare(b.workspaceId)
      if (!a.updatedAt) return 1
      if (!b.updatedAt) return -1
      return b.updatedAt.localeCompare(a.updatedAt)
    })

    return summaries
  }

  private enqueueCommand(
    operation: () => Promise<RuntimeCommandResponse>,
  ): Promise<RuntimeCommandResponse> {
    const run = this.commandQueue.then(operation, operation)
    this.commandQueue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private async executeCommandInternal(
    request: RuntimeCommandRequest,
  ): Promise<RuntimeCommandResponse> {
    try {
      switch (request.command) {
        case "coordinator_prompt":
          return this.executeCoordinatorPrompt(request)

        case "create_solver":
        case "update_solver_environment":
        case "confirm_solver_flag":
          return this.executeCoordinatorTool(request)

        case "solver_steer":
          return this.executeSolverSteer(request)

        case "solver_abort":
          return this.executeSolverAbort(request)

        case "solver_continue":
          return this.executeSolverContinue(request)

        case "server_restart":
          return this.executeServerRestart(request)

        case "add_model_to_pool":
          return this.executeAddModelToPool(request)

        case "set_model_concurrency":
          return this.executeSetModelConcurrency(request)
      }
    } catch (error) {
      const message = error instanceof Error ? formatError(error) : "Non-error exception thrown"
      this.publish("server", "error", {
        source: "execute_command",
        command: request.command,
        message,
      })
      return { ok: false, requestId: request.requestId, error: message }
    }
  }

  private executeCoordinatorPrompt(
    request: RuntimeCommandRequestFor<"coordinator_prompt">,
  ): RuntimeCommandResponse {
    const message = request.payload.message.trim()
    if (message.length === 0) {
      return { ok: false, requestId: request.requestId, error: "payload.message is required" }
    }

    this.publish("server", "runtime.command.accepted", {
      requestId: request.requestId ?? "",
      command: request.command,
    })

    void this.coordinator.prompt(message).catch((error) => {
      this.publish("server", "error", {
        source: "coordinator_prompt",
        message: formatError(error),
      })
    })

    return {
      ok: true,
      requestId: request.requestId,
      payload: { accepted: true },
    }
  }

  private async executeCoordinatorTool(
    request: RuntimeCommandRequestFor<CoordinatorToolName>,
  ): Promise<RuntimeCommandResponse> {
    const tool = this.findCoordinatorTool(request.command)
    if (!tool) {
      return {
        ok: false,
        requestId: request.requestId,
        error: `coordinator tool not available: ${request.command}`,
      }
    }

    const result = await tool.execute(`server-${Date.now()}`, request.payload)
    this.publish("server", "runtime.command.executed", {
      requestId: request.requestId ?? "",
      command: request.command,
    })

    return {
      ok: true,
      requestId: request.requestId,
      payload: normalizeRuntimePayload(result),
    }
  }

  private executeSolverSteer(
    request: RuntimeCommandRequestFor<"solver_steer">,
  ): RuntimeCommandResponse {
    const solver = this.coordinator.solvers.get(request.payload.solverId)
    if (!solver) {
      return {
        ok: false,
        requestId: request.requestId,
        error: `solver not found: ${request.payload.solverId}`,
      }
    }

    solver.steer(request.payload.message)
    this.publish("server", "runtime.command.executed", {
      requestId: request.requestId ?? "",
      command: request.command,
      solverId: request.payload.solverId,
    })
    return { ok: true, requestId: request.requestId }
  }

  private executeSolverAbort(
    request: RuntimeCommandRequestFor<"solver_abort">,
  ): RuntimeCommandResponse {
    const solver = this.coordinator.solvers.get(request.payload.solverId)
    if (!solver) {
      return {
        ok: false,
        requestId: request.requestId,
        error: `solver not found: ${request.payload.solverId}`,
      }
    }

    solver.abort()
    this.publish("server", "runtime.command.executed", {
      requestId: request.requestId ?? "",
      command: request.command,
      solverId: request.payload.solverId,
    })
    return { ok: true, requestId: request.requestId }
  }

  private executeSolverContinue(
    request: RuntimeCommandRequestFor<"solver_continue">,
  ): RuntimeCommandResponse {
    const solver = this.coordinator.solvers.get(request.payload.solverId)
    if (!solver) {
      return {
        ok: false,
        requestId: request.requestId,
        error: `solver not found: ${request.payload.solverId}`,
      }
    }

    void solver.continue().catch((error) => {
      this.publish("server", "error", {
        source: "solver_continue",
        solverId: request.payload.solverId,
        message: formatError(error),
      })
    })

    this.publish("server", "runtime.command.accepted", {
      requestId: request.requestId ?? "",
      command: request.command,
      solverId: request.payload.solverId,
    })
    return { ok: true, requestId: request.requestId, payload: { accepted: true } }
  }

  private executeServerRestart(
    request: RuntimeCommandRequestFor<"server_restart">,
  ): RuntimeCommandResponse {
    if (!this.onServerRestartRequested) {
      return {
        ok: false,
        requestId: request.requestId,
        error: "server restart is not enabled in this runtime",
      }
    }

    this.publish("server", "runtime.command.accepted", {
      requestId: request.requestId ?? "",
      command: request.command,
      graceful: request.payload.graceful ?? true,
    })

    void Promise.resolve(this.onServerRestartRequested()).catch((error) => {
      this.publish("server", "error", {
        source: "server_restart",
        message: formatError(error),
      })
    })

    return {
      ok: true,
      requestId: request.requestId,
      payload: { accepted: true },
    }
  }

  private async executeAddModelToPool(
    request: RuntimeCommandRequestFor<"add_model_to_pool">,
  ): Promise<RuntimeCommandResponse> {
    const modelId = request.payload.modelId.trim()
    const concurrency = request.payload.concurrency ?? 1

    if (modelId.length === 0) {
      return {
        ok: false,
        requestId: request.requestId,
        error: "payload.modelId is required",
      }
    }

    if (this.ensureModelAvailable) {
      await this.ensureModelAvailable(modelId)
    }

    const result = this.coordinator.addModelToPool(modelId, concurrency)
    this.publish("server", "runtime.command.executed", {
      requestId: request.requestId ?? "",
      command: request.command,
      modelId,
      concurrency,
      totalSlotsForModel: result.total,
      totalPoolSlots: this.coordinator.modelPool.total,
    })

    return {
      ok: true,
      requestId: request.requestId,
      payload: normalizeRuntimePayload(result),
    }
  }

  private async executeSetModelConcurrency(
    request: RuntimeCommandRequestFor<"set_model_concurrency">,
  ): Promise<RuntimeCommandResponse> {
    const modelId = request.payload.modelId.trim()
    const concurrency = request.payload.concurrency

    if (modelId.length === 0) {
      return {
        ok: false,
        requestId: request.requestId,
        error: "payload.modelId is required",
      }
    }

    if (this.ensureModelAvailable) {
      await this.ensureModelAvailable(modelId)
    }

    const result = this.coordinator.setModelPoolConcurrency(modelId, concurrency)
    this.publish("server", "runtime.command.executed", {
      requestId: request.requestId ?? "",
      command: request.command,
      modelId,
      concurrency,
      totalSlotsForModel: result.total,
      busySlotsForModel: result.busy,
      totalPoolSlots: this.coordinator.modelPool.total,
    })

    return {
      ok: true,
      requestId: request.requestId,
      payload: normalizeRuntimePayload(result),
    }
  }

  private findCoordinatorTool(name: CoordinatorToolName): AgentTool | undefined {
    return this.coordinator.state.tools.find((tool) => tool.name === name)
  }

  private syncSolverSubscriptions() {
    const activeSolverIds = new Set(this.coordinator.solvers.keys())

    for (const solverId of activeSolverIds) {
      if (this.solverSubscriptions.has(solverId)) continue

      const solver = this.coordinator.solvers.get(solverId)
      if (!solver) continue

      const unsubscribe = solver.subscribe((event) => {
        this.handleSolverEvent(solverId, solver, event)
      })
      this.solverSubscriptions.set(solverId, unsubscribe)
      this.publish("solver", "solver.added", { solverId })
    }

    for (const [solverId, unsubscribe] of this.solverSubscriptions.entries()) {
      if (activeSolverIds.has(solverId)) continue

      unsubscribe()
      this.solverSubscriptions.delete(solverId)
      this.publish("solver", "solver.removed", { solverId })
    }
  }

  private handleCoordinatorEvent(event: AgentEvent) {
    switch (event.type) {
      case "tool_execution_start": {
        this.publish("coordinator", "coordinator.tool.start", {
          toolName: event.toolName,
        })
        break
      }

      case "tool_execution_end": {
        this.publish("coordinator", "coordinator.tool.end", {
          toolName: event.toolName,
          isError: event.isError,
        })
        break
      }

      case "message_end": {
        const message = event.message
        this.publish("coordinator", "coordinator.message", {
          role: message.role,
          summary: summarizeMessage(message),
        })
        break
      }

      case "agent_end": {
        this.publish("coordinator", "coordinator.stopped", {
          messageCount: this.coordinator.state.messages.length,
        })
        break
      }
    }
  }

  private handleSolverEvent(solverId: string, solver: Solver, event: AgentEvent) {
    switch (event.type) {
      case "message_end": {
        const message = event.message
        this.publish("solver", "solver.message", {
          solverId,
          role: message.role,
          summary: summarizeMessage(message),
        })

        if (message.role === "flagResult") {
          this.publish("solver", "solver.flag.reported", {
            solverId,
            flag: message.flag,
            correct: message.correct,
          })
        }

        break
      }

      case "tool_execution_start": {
        this.publish("solver", "solver.tool.start", {
          solverId,
          toolName: event.toolName,
        })
        break
      }

      case "tool_execution_end": {
        this.publish("solver", "solver.tool.end", {
          solverId,
          toolName: event.toolName,
          isError: event.isError,
        })
        break
      }

      case "message_update": {
        if (event.assistantMessageEvent.type === "text_delta") {
          this.publish("solver", "solver.text.delta", {
            solverId,
            deltaLength: event.assistantMessageEvent.delta.length,
          })
        }
        break
      }

      case "agent_end": {
        this.publish("solver", "solver.stopped", {
          solverId,
          messageCount: solver.state.messages.length,
        })
        break
      }
    }
  }

  private readPersistedSolverState(solverId: string): PersistedSolverState {
    const raw = this.coordinator.persistence.loadSolverState(solverId)
    if (!raw) return {}

    const state = raw as Record<string, RuntimeJsonValue>
    const challengeName = typeof state.challengeName === "string" ? state.challengeName : undefined
    const status = typeof state.status === "string" ? state.status : undefined
    const model = typeof state.model === "string" ? state.model : undefined
    const updatedAt = typeof state.updatedAt === "string" ? state.updatedAt : undefined
    return { challengeName, status, model, updatedAt }
  }

  private tryWorkspaceId(): string | undefined {
    try {
      return this.coordinator.persistence.readManifest().id
    } catch {
      return undefined
    }
  }

  private publish(source: RuntimeEventEnvelope["source"], type: string, payload: RuntimeJsonValue) {
    const event: RuntimeEventEnvelope = {
      seq: ++this.seq,
      ts: new Date().toISOString(),
      source,
      type,
      payload,
    }

    this.events.push(event)
    if (this.events.length > this.replayLimit) {
      this.events.splice(0, this.events.length - this.replayLimit)
    }

    for (const listener of this.listeners) {
      listener(event)
    }
  }
}

function summarizeMessage(message: AgentMessage): string {
  if (message.role === "assistant") {
    const textChunk = message.content.find((chunk) => chunk.type === "text")
    if (!textChunk) return "assistant message"
    return truncate(textChunk.text, 240)
  }

  if (message.role === "user") {
    const content =
      typeof message.content === "string"
        ? message.content
        : (safeJsonStringify(message.content) ?? "[unserializable user content]")
    return truncate(content, 240)
  }

  if (message.role === "toolResult") {
    const joined = message.content
      .map((chunk) => ("text" in chunk ? chunk.text : "[image]"))
      .join(" ")
    return truncate(joined, 240)
  }

  return `${message.role} message`
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}...`
}

function normalizeSolverStatus(value: string | undefined): SolverSnapshot["status"] {
  switch (value) {
    case "assigned":
    case "solving":
    case "solved":
    case "failed":
    case "stopped":
      return value
    default:
      return "solving"
  }
}

function formatError(error: Error | string | object | null | undefined): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (!error) return "Unknown error"
  return safeJsonStringify(error) ?? "[unserializable error]"
}

function asRuntimeJsonValue(value: RuntimeJsonValue): RuntimeJsonValue {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item) => asRuntimeJsonValue(item))
  }

  const objectValue = value as Record<string, RuntimeJsonValue>
  const normalized: { [key: string]: RuntimeJsonValue } = {}
  for (const [key, item] of Object.entries(objectValue)) {
    normalized[key] = asRuntimeJsonValue(item)
  }
  return normalized
}

function normalizeRuntimePayload(value: object | RuntimeJsonValue): RuntimeJsonValue {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value
  }

  const serialized = safeJsonStringify(value)
  if (!serialized) {
    return { error: "payload serialization failed" }
  }

  return asRuntimeJsonValue(JSON.parse(serialized) as RuntimeJsonValue)
}

function safeJsonStringify(value: object | RuntimeJsonValue | null): string | undefined {
  try {
    return JSON.stringify(value)
  } catch {
    return undefined
  }
}
