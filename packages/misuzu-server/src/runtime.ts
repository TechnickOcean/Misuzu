import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import type { AgentEvent, AgentMessage, AgentTool } from "@mariozechner/pi-agent-core"
import { Coordinator, defaultWorkspacesRoot, type Solver } from "misuzu-core"
import type {
  LoadWorkspaceResultPayload,
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

export interface WorkspaceLoadOptions {
  workspaceDir: string
  autoContinueSolvers?: boolean
}

export interface MisuzuRuntimeHostOptions {
  workspacesRoot?: string
  workspaceRoot?: string
  replayLimit?: number
  startupEventType?: "runtime.started" | "runtime.resumed" | "runtime.idle"
  ensureModelAvailable?: (modelId: string) => Promise<void> | void
  onServerRestartRequested?: () => Promise<void> | void
  onLoadWorkspace?: (options: WorkspaceLoadOptions) => Promise<Coordinator>
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

interface UrlPendingSnapshotItem {
  challengeId: string
  challengeName: string
  category: string
  difficulty?: number
}

type CoordinatorToolName = "create_solver" | "update_solver_environment" | "confirm_solver_flag"

interface CoordinatorWithQueues {
  challengeQueue: Array<{
    challengeId: string
    challengeName: string
    category: string
    difficulty?: number
  }>
  urlPendingQueue: Array<{
    challengeId: string
    challengeName: string
    category: string
    difficulty?: number
  }>
  dispatchQueuedChallenges: () => Promise<void>
}

export class MisuzuRuntimeHost implements RuntimeHost {
  private readonly listeners = new Set<(event: RuntimeEventEnvelope) => void>()
  private readonly events: RuntimeEventEnvelope[] = []
  private readonly solverSubscriptions = new Map<string, () => void>()
  private readonly replayLimit: number
  private readonly workspacesRoot: string
  private readonly workspaceRoot: string
  private readonly ensureModelAvailable?: (modelId: string) => Promise<void> | void
  private readonly onServerRestartRequested?: () => Promise<void> | void
  private readonly onLoadWorkspace?: (options: WorkspaceLoadOptions) => Promise<Coordinator>
  private coordinatorSubscription?: () => void
  private coordinator: Coordinator | null
  private seq = 0
  private commandQueue: Promise<void> = Promise.resolve()

  constructor(coordinator: Coordinator | null, options: MisuzuRuntimeHostOptions = {}) {
    this.coordinator = coordinator
    this.workspaceRoot = options.workspaceRoot ?? coordinator?.workspaceRoot ?? process.cwd()
    this.workspacesRoot = resolve(
      options.workspacesRoot ?? defaultWorkspacesRoot(this.workspaceRoot),
    )
    this.replayLimit = Math.max(100, options.replayLimit ?? 1000)
    this.ensureModelAvailable = options.ensureModelAvailable
    this.onServerRestartRequested = options.onServerRestartRequested
    this.onLoadWorkspace = options.onLoadWorkspace

    if (this.coordinator) {
      this.coordinatorSubscription = this.coordinator.subscribe((event) => {
        this.handleCoordinatorEvent(event)
        this.syncSolverSubscriptions()
      })
      this.syncSolverSubscriptions()
    }

    const eventType = this.coordinator
      ? (options.startupEventType ?? "runtime.started")
      : "runtime.idle"

    this.publish("server", eventType, {
      workspaceId: this.tryWorkspaceId() ?? "unavailable",
      workspaceRoot: this.workspaceRoot,
    })
  }

  setCoordinator(coordinator: Coordinator | null): void {
    // Unsubscribe from old coordinator
    if (this.coordinatorSubscription) {
      this.coordinatorSubscription()
      this.coordinatorSubscription = undefined
    }

    for (const unsubscribe of this.solverSubscriptions.values()) {
      unsubscribe()
    }
    this.solverSubscriptions.clear()

    this.coordinator = coordinator

    if (this.coordinator) {
      this.coordinatorSubscription = this.coordinator.subscribe((event) => {
        this.handleCoordinatorEvent(event)
        this.syncSolverSubscriptions()
      })
      this.syncSolverSubscriptions()

      this.publish("server", "runtime.resumed", {
        workspaceId: this.tryWorkspaceId() ?? "unavailable",
        workspaceRoot: this.coordinator.workspaceRoot,
      })
    } else {
      this.publish("server", "runtime.idle", {
        workspaceId: "unavailable",
        workspaceRoot: this.workspaceRoot,
      })
    }
  }

  async shutdownCoordinator(): Promise<void> {
    if (!this.coordinator) return

    // Abort all active solvers and persist their states
    for (const [solverId, solver] of this.coordinator.solvers) {
      try {
        solver.abort()
      } catch {
        // Best-effort abort
      }
      try {
        this.coordinator.persistence.saveSolverState(solverId, {
          ...this.coordinator.persistence.loadSolverState(solverId),
          status: "stopped",
          updatedAt: new Date().toISOString(),
        })
      } catch {
        // Best-effort persist
      }
    }

    // Persist coordinator state via persistence API (bypasses private method)
    try {
      this.coordinator.persistence.saveCoordinatorState({
        workspaceRoot: this.coordinator.workspaceRoot,
        modelPool: this.coordinator.modelPool.toJSON(),
        solvers: Array.from(this.coordinator.solvers.keys()),
        challengeQueue: (this.coordinator as unknown as CoordinatorWithQueues).challengeQueue ?? [],
        urlPendingQueue:
          (this.coordinator as unknown as CoordinatorWithQueues).urlPendingQueue ?? [],
        updatedAt: new Date().toISOString(),
      })
    } catch {
      // Best-effort
    }

    // Close persistence
    try {
      this.coordinator.persistence.close()
    } catch {
      // Best-effort
    }

    this.publish("server", "coordinator.shutdown", {
      workspaceId: this.tryWorkspaceId() ?? "unknown",
    })

    this.setCoordinator(null)
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
    if (!this.coordinator) {
      return {
        protocolVersion: 1,
        coordinatorStatus: "idle",
        workspaceId: undefined,
        workspaceRoot: this.workspaceRoot,
        modelPool: { slots: [], available: 0, total: 0 },
        challengeQueue: [],
        urlPendingQueue: [],
        solvers: [],
        generatedAt: new Date().toISOString(),
        lastSeq: this.seq,
      }
    }

    const slots = this.coordinator.modelPool.toJSON()
    const workspaceId = this.tryWorkspaceId()
    const solvers: SolverSnapshot[] = []
    const urlPendingQueue = this.readUrlPendingQueue()

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

    for (const pending of urlPendingQueue) {
      if (solvers.some((solver) => solver.solverId === pending.challengeId)) {
        continue
      }

      const persisted = this.readPersistedSolverState(pending.challengeId)
      solvers.push({
        solverId: pending.challengeId,
        challengeName: pending.challengeName,
        status: "url_pending",
        model: persisted.model,
        messageCount: 0,
        isStreaming: false,
        updatedAt: persisted.updatedAt,
      })
    }

    solvers.sort((a, b) => a.solverId.localeCompare(b.solverId))

    return {
      protocolVersion: 1,
      coordinatorStatus: "active",
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
      urlPendingQueue: urlPendingQueue.map((challenge) => ({
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

  private requireCoordinator(): Coordinator | null {
    return this.coordinator
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
        case "load_workspace":
          return await this.executeLoadWorkspace(request)

        case "shutdown_coordinator":
          return await this.executeShutdownCoordinator(request)

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

        case "solver_stop":
          return this.executeSolverStop(request)

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

  private async executeLoadWorkspace(
    request: RuntimeCommandRequestFor<"load_workspace">,
  ): Promise<RuntimeCommandResponse> {
    const { workspaceDir, autoContinueSolvers = true } = request.payload

    if (!workspaceDir || workspaceDir.trim().length === 0) {
      return { ok: false, requestId: request.requestId, error: "payload.workspaceDir is required" }
    }

    const manifestPath = join(workspaceDir, "manifest.json")
    if (!existsSync(manifestPath)) {
      return {
        ok: false,
        requestId: request.requestId,
        error: `workspace not found: ${workspaceDir}`,
      }
    }

    // If a coordinator is already active, shut it down first
    if (this.coordinator) {
      await this.shutdownCoordinator()
    }

    if (!this.onLoadWorkspace) {
      return {
        ok: false,
        requestId: request.requestId,
        error: "workspace loading is not configured on this server (no onLoadWorkspace handler)",
      }
    }

    const coordinator = await this.onLoadWorkspace({ workspaceDir, autoContinueSolvers })
    this.setCoordinator(coordinator)

    const workspaceId = coordinator.persistence.readManifest().id
    this.publish("server", "runtime.command.executed", {
      requestId: request.requestId ?? "",
      command: request.command,
      workspaceId,
    })

    return {
      ok: true,
      requestId: request.requestId,
      payload: { workspaceId } satisfies LoadWorkspaceResultPayload,
    }
  }

  private async executeShutdownCoordinator(
    request: RuntimeCommandRequestFor<"shutdown_coordinator">,
  ): Promise<RuntimeCommandResponse> {
    if (!this.coordinator) {
      return { ok: false, requestId: request.requestId, error: "no active coordinator" }
    }

    this.publish("server", "runtime.command.accepted", {
      requestId: request.requestId ?? "",
      command: request.command,
    })

    await this.shutdownCoordinator()

    return {
      ok: true,
      requestId: request.requestId,
      payload: { message: "coordinator stopped, server is now idle" },
    }
  }

  private executeCoordinatorPrompt(
    request: RuntimeCommandRequestFor<"coordinator_prompt">,
  ): RuntimeCommandResponse {
    const coordinator = this.requireCoordinator()
    if (!coordinator) {
      return { ok: false, requestId: request.requestId, error: "no active coordinator" }
    }

    const message = request.payload.message.trim()
    if (message.length === 0) {
      return { ok: false, requestId: request.requestId, error: "payload.message is required" }
    }

    this.publish("server", "runtime.command.accepted", {
      requestId: request.requestId ?? "",
      command: request.command,
    })

    void coordinator.prompt(message).catch((error) => {
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
    const coordinator = this.requireCoordinator()
    if (!coordinator) {
      return { ok: false, requestId: request.requestId, error: "no active coordinator" }
    }

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
    const coordinator = this.requireCoordinator()
    if (!coordinator) {
      return { ok: false, requestId: request.requestId, error: "no active coordinator" }
    }

    const solver = coordinator.solvers.get(request.payload.solverId)
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

    if (!solver.state.isStreaming) {
      void solver.continue().catch((error) => {
        this.publish("server", "error", {
          source: "solver_steer",
          solverId: request.payload.solverId,
          message: formatError(error),
        })
      })
    }

    return { ok: true, requestId: request.requestId }
  }

  private executeSolverAbort(
    request: RuntimeCommandRequestFor<"solver_abort">,
  ): RuntimeCommandResponse {
    const coordinator = this.requireCoordinator()
    if (!coordinator) {
      return { ok: false, requestId: request.requestId, error: "no active coordinator" }
    }

    const solver = coordinator.solvers.get(request.payload.solverId)
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
    const coordinator = this.requireCoordinator()
    if (!coordinator) {
      return { ok: false, requestId: request.requestId, error: "no active coordinator" }
    }

    const solver = coordinator.solvers.get(request.payload.solverId)
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

  private executeSolverStop(
    request: RuntimeCommandRequestFor<"solver_stop">,
  ): RuntimeCommandResponse {
    const coordinator = this.requireCoordinator()
    if (!coordinator) {
      return { ok: false, requestId: request.requestId, error: "no active coordinator" }
    }

    const solverId = request.payload.solverId
    const solver = coordinator.solvers.get(solverId)
    if (!solver) {
      return {
        ok: false,
        requestId: request.requestId,
        error: `solver not found: ${solverId}`,
      }
    }

    // Persist state with status=stopped before aborting
    try {
      coordinator.persistence.saveSolverState(solverId, {
        ...coordinator.persistence.loadSolverState(solverId),
        status: "stopped",
        updatedAt: new Date().toISOString(),
      })
    } catch {
      // Best-effort persist
    }

    solver.abort()
    coordinator.solvers.delete(solverId)

    // Release model slot
    coordinator.modelPool.release(solverId)

    // Dispatch queued challenges since a slot freed up (private method)
    void (coordinator as unknown as CoordinatorWithQueues).dispatchQueuedChallenges()

    this.publish("server", "runtime.command.executed", {
      requestId: request.requestId ?? "",
      command: request.command,
      solverId,
    })

    this.publish("solver", "solver.removed", { solverId })

    return { ok: true, requestId: request.requestId }
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
    const coordinator = this.requireCoordinator()
    if (!coordinator) {
      return { ok: false, requestId: request.requestId, error: "no active coordinator" }
    }

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

    const result = coordinator.addModelToPool(modelId, concurrency)
    this.publish("server", "runtime.command.executed", {
      requestId: request.requestId ?? "",
      command: request.command,
      modelId,
      concurrency,
      totalSlotsForModel: result.total,
      totalPoolSlots: coordinator.modelPool.total,
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
    const coordinator = this.requireCoordinator()
    if (!coordinator) {
      return { ok: false, requestId: request.requestId, error: "no active coordinator" }
    }

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

    const result = coordinator.setModelPoolConcurrency(modelId, concurrency)
    this.publish("server", "runtime.command.executed", {
      requestId: request.requestId ?? "",
      command: request.command,
      modelId,
      concurrency,
      totalSlotsForModel: result.total,
      busySlotsForModel: result.busy,
      totalPoolSlots: coordinator.modelPool.total,
    })

    return {
      ok: true,
      requestId: request.requestId,
      payload: normalizeRuntimePayload(result),
    }
  }

  private findCoordinatorTool(name: CoordinatorToolName): AgentTool | undefined {
    return this.coordinator?.state.tools.find((tool) => tool.name === name)
  }

  private syncSolverSubscriptions() {
    if (!this.coordinator) return

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
          messageCount: this.coordinator?.state.messages.length ?? 0,
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
    if (!this.coordinator) return {}
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
      return this.coordinator?.persistence.readManifest().id
    } catch {
      return undefined
    }
  }

  private readUrlPendingQueue(): UrlPendingSnapshotItem[] {
    if (!this.coordinator) return []

    const coordinatorWithQueue = this.coordinator as unknown as {
      urlPendingQueue?: Array<{
        challengeId?: string
        challengeName?: string
        category?: string
        difficulty?: number
      }>
    }

    if (!Array.isArray(coordinatorWithQueue.urlPendingQueue)) {
      return []
    }

    return coordinatorWithQueue.urlPendingQueue
      .filter((item) => typeof item.challengeId === "string")
      .map((item) => ({
        challengeId: item.challengeId!,
        challengeName: item.challengeName ?? item.challengeId!,
        category: item.category ?? "unknown",
        difficulty: typeof item.difficulty === "number" ? item.difficulty : undefined,
      }))
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
    case "url_pending":
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
