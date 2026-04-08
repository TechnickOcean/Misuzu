import type { PersistedCTFRuntimeInflightTask, PersistedCTFRuntimeQueueState } from "../../state.ts"
import { resolveChallengeIdFromTaskPayload } from "../../helpers.ts"

export interface SolverTask {
  taskId: string
  payload: unknown
}

export interface DispatchTask {
  taskId: string
  challengeId: number
  targetSolverId: string
  payload: unknown
  source: "auto" | "manual"
  priority: number
  createdAt: number
  reason?: string
}

export interface SolverTaskResult {
  taskId: string
  solverId: string
  output: unknown
}

export interface SolverExecutionState {
  active: boolean
  activeTaskId?: string
}

export class SolverDispatchDeferredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SolverDispatchDeferredError"
  }
}

export type SolverTaskCancelResult = "pending" | "inflight"

export interface SolverRunner {
  solverId: string
  solve(task: SolverTask, context?: unknown): Promise<unknown>
  abortActiveTask?(): void
}

type QueueStateChangeListener = () => void

export class QueueService {
  private readonly solverRegistry = new Map<string, SolverRunner>()
  private readonly inflightTasksBySolver = new Map<string, DispatchTask>()
  private readonly inflightTasksByTaskId = new Map<string, DispatchTask>()
  private onStateChanged: QueueStateChangeListener = () => {}

  setStateChangeListener(listener: QueueStateChangeListener) {
    this.onStateChanged = listener
  }

  registerSolver(solver: SolverRunner) {
    if (this.solverRegistry.has(solver.solverId)) {
      throw new Error(`Solver already registered: ${solver.solverId}`)
    }

    this.solverRegistry.set(solver.solverId, solver)
    this.notifyStateChanged()
  }

  unregisterSolver(solverId: string) {
    this.solverRegistry.delete(solverId)

    const inflightTask = this.inflightTasksBySolver.get(solverId)
    if (inflightTask) {
      this.inflightTasksBySolver.delete(solverId)
      this.inflightTasksByTaskId.delete(inflightTask.taskId)
    }

    this.notifyStateChanged()
  }

  runTask(task: DispatchTask, context?: unknown) {
    const solver = this.solverRegistry.get(task.targetSolverId)
    if (!solver) {
      throw new Error(`Cannot execute task ${task.taskId}: solver is not registered`)
    }

    if (this.inflightTasksByTaskId.has(task.taskId)) {
      throw new Error(`Cannot execute task ${task.taskId}: task is already inflight`)
    }

    if (this.inflightTasksBySolver.has(task.targetSolverId)) {
      throw new Error(`Cannot execute task ${task.taskId}: solver is already busy`)
    }

    this.inflightTasksBySolver.set(task.targetSolverId, task)
    this.inflightTasksByTaskId.set(task.taskId, task)
    this.notifyStateChanged()

    return Promise.resolve(
      solver.solve(
        {
          taskId: task.taskId,
          payload: task.payload,
        },
        context,
      ),
    )
      .then((output) => {
        this.releaseTask(task)
        return {
          taskId: task.taskId,
          solverId: task.targetSolverId,
          output,
        } satisfies SolverTaskResult
      })
      .catch((error) => {
        this.releaseTask(task)
        throw error
      })
  }

  snapshotState(): PersistedCTFRuntimeQueueState {
    return {
      taskSequence: 0,
      paused: false,
      pendingTasks: [],
      inflightTasks: [...this.inflightTasksByTaskId.values()].map((task) =>
        this.toPersistedInflightTask(task),
      ),
    }
  }

  getState() {
    return {
      paused: false,
      pendingTaskCount: 0,
      idleSolverCount: this.solverRegistry.size - this.inflightTasksBySolver.size,
      busySolverCount: this.inflightTasksBySolver.size,
      registeredSolverCount: this.solverRegistry.size,
      inflightTaskCount: this.inflightTasksByTaskId.size,
    }
  }

  getSolverExecutionState(solverId: string): SolverExecutionState {
    const activeTask = this.inflightTasksBySolver.get(solverId)

    if (!activeTask) {
      return { active: false }
    }

    return {
      active: true,
      activeTaskId: activeTask.taskId,
    }
  }

  listPendingTasks() {
    return []
  }

  listInflightTasks() {
    return [...this.inflightTasksByTaskId.values()].map((task) => ({
      solverId: task.targetSolverId,
      task: {
        taskId: task.taskId,
        payload: task.payload,
      },
      dispatch: { ...task },
    }))
  }

  listInflightDispatchTasks() {
    return [...this.inflightTasksByTaskId.values()].map((task) => ({ ...task }))
  }

  hasSolver(solverId: string) {
    return this.solverRegistry.has(solverId)
  }

  cancelTask(taskId: string): SolverTaskCancelResult | undefined {
    const inflightTask = this.inflightTasksByTaskId.get(taskId)
    if (!inflightTask) {
      return undefined
    }

    this.solverRegistry.get(inflightTask.targetSolverId)?.abortActiveTask?.()
    return "inflight"
  }

  restoreQueueTasksAsPendingTasks(state: PersistedCTFRuntimeQueueState | undefined) {
    if (!state) {
      return []
    }

    return [...state.inflightTasks, ...state.pendingTasks]
      .map((task) => ({
        task,
        challengeId: task.challengeId ?? resolveChallengeIdFromTaskPayload(task.payload),
        targetSolverId:
          task.targetSolverId ??
          ("solverId" in task && typeof task.solverId === "string" ? task.solverId : undefined),
      }))
      .filter(
        (entry) => Number.isFinite(entry.challengeId) && typeof entry.targetSolverId === "string",
      )
      .map(
        (task) =>
          ({
            taskId: task.task.taskId,
            challengeId: task.challengeId!,
            targetSolverId: task.targetSolverId!,
            payload: task.task.payload,
            source: task.task.source ?? "manual",
            priority: task.task.priority ?? 0,
            createdAt: task.task.createdAt ?? Date.now(),
            reason: task.task.reason,
          }) satisfies DispatchTask,
      )
  }

  abortAllRunningTasks() {
    for (const task of this.inflightTasksByTaskId.values()) {
      this.solverRegistry.get(task.targetSolverId)?.abortActiveTask?.()
    }
  }

  private releaseTask(task: DispatchTask) {
    const existing = this.inflightTasksByTaskId.get(task.taskId)
    if (!existing) {
      return
    }

    this.inflightTasksByTaskId.delete(task.taskId)
    this.inflightTasksBySolver.delete(task.targetSolverId)
    this.notifyStateChanged()
  }

  private toPersistedInflightTask(task: DispatchTask): PersistedCTFRuntimeInflightTask {
    return {
      taskId: task.taskId,
      payload: task.payload,
      solverId: task.targetSolverId,
      challengeId: task.challengeId,
      targetSolverId: task.targetSolverId,
      source: task.source,
      priority: task.priority,
      createdAt: task.createdAt,
      reason: task.reason,
    }
  }

  private notifyStateChanged() {
    this.onStateChanged()
  }
}
