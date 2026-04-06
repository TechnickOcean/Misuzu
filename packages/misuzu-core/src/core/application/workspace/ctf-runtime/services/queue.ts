import type { PersistedCTFRuntimeQueueState, PersistedCTFRuntimeQueueTask } from "../state.ts"

export interface SolverTask {
  taskId: string
  payload: unknown
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

export interface SolverRunner {
  solverId: string
  solve(task: SolverTask): Promise<unknown>
  abortActiveTask?(): void
}

interface PendingSolverTask {
  task: SolverTask
  resolve: (result: SolverTaskResult) => void
  reject: (error: unknown) => void
}

type QueueStateChangeListener = () => void

export class QueueService {
  private readonly solverRegistry = new Map<string, SolverRunner>()
  private readonly pendingTaskQueue: PendingSolverTask[] = []
  private readonly idleSolverQueue: string[] = []
  private readonly busySolverIds = new Set<string>()
  private readonly inflightTasks = new Map<string, SolverTask>()
  private taskSequence = 0
  private paused = false
  private onStateChanged: QueueStateChangeListener = () => {}

  setStateChangeListener(listener: QueueStateChangeListener) {
    this.onStateChanged = listener
  }

  registerSolver(solver: SolverRunner) {
    if (this.solverRegistry.has(solver.solverId)) {
      throw new Error(`Solver already registered: ${solver.solverId}`)
    }

    this.solverRegistry.set(solver.solverId, solver)
    this.idleSolverQueue.push(solver.solverId)
    this.notifyStateChanged()
    this.scheduleDispatch()
  }

  unregisterSolver(solverId: string) {
    this.solverRegistry.delete(solverId)

    const solverIndex = this.idleSolverQueue.indexOf(solverId)
    if (solverIndex >= 0) {
      this.idleSolverQueue.splice(solverIndex, 1)
    }

    this.inflightTasks.delete(solverId)
    this.notifyStateChanged()
  }

  enqueueTask(payload: unknown, taskId = this.nextTaskId()) {
    const task: SolverTask = { taskId, payload }

    return new Promise<SolverTaskResult>((resolve, reject) => {
      this.pendingTaskQueue.push({ task, resolve, reject })
      this.notifyStateChanged()
      this.scheduleDispatch()
    })
  }

  pause() {
    if (this.paused) {
      return
    }

    this.paused = true
    this.abortRunningTasks()
    this.notifyStateChanged()
  }

  resume() {
    if (!this.paused) {
      return
    }

    this.paused = false
    this.notifyStateChanged()
    this.scheduleDispatch()
  }

  isPaused() {
    return this.paused
  }

  restoreState(state: PersistedCTFRuntimeQueueState | undefined) {
    if (!state) {
      return
    }

    this.taskSequence = Number.isFinite(state.taskSequence)
      ? Math.max(0, Math.floor(state.taskSequence))
      : 0
    this.paused = typeof state.paused === "boolean" ? state.paused : false

    this.pendingTaskQueue.length = 0
    this.inflightTasks.clear()
    this.enqueueRestoredTasks(state)

    this.notifyStateChanged()
    this.scheduleDispatch()
  }

  snapshotState(): PersistedCTFRuntimeQueueState {
    return {
      taskSequence: this.taskSequence,
      paused: this.paused,
      pendingTasks: this.pendingTaskQueue.map((pendingTask) => ({
        taskId: pendingTask.task.taskId,
        payload: pendingTask.task.payload,
      })),
      inflightTasks: [...this.inflightTasks.entries()].map(([solverId, task]) => ({
        solverId,
        taskId: task.taskId,
        payload: task.payload,
      })),
    }
  }

  getState() {
    return {
      paused: this.paused,
      pendingTaskCount: this.pendingTaskQueue.length,
      idleSolverCount: this.idleSolverQueue.length,
      busySolverCount: this.busySolverIds.size,
      registeredSolverCount: this.solverRegistry.size,
    }
  }

  getSolverExecutionState(solverId: string): SolverExecutionState {
    const activeTask = this.inflightTasks.get(solverId)

    if (!activeTask) {
      return { active: false }
    }

    return {
      active: true,
      activeTaskId: activeTask.taskId,
    }
  }

  listPendingTasks() {
    return this.pendingTaskQueue.map((pendingTask) => ({
      taskId: pendingTask.task.taskId,
      payload: pendingTask.task.payload,
    }))
  }

  listInflightTasks() {
    return [...this.inflightTasks.entries()].map(([solverId, task]) => ({
      solverId,
      task: {
        taskId: task.taskId,
        payload: task.payload,
      },
    }))
  }

  private nextTaskId() {
    this.taskSequence += 1
    return `task-${this.taskSequence}`
  }

  private scheduleDispatch() {
    while (this.dispatchNextTask()) {
      // keep dispatching until no task/solver pair is available
    }
  }

  private dispatchNextTask() {
    if (this.paused) {
      return false
    }

    const pendingTask = this.pendingTaskQueue.shift()
    if (!pendingTask) {
      return false
    }

    const solverId = this.idleSolverQueue.shift()
    if (!solverId) {
      this.pendingTaskQueue.unshift(pendingTask)
      return false
    }

    const solver = this.solverRegistry.get(solverId)
    if (!solver) {
      return this.pendingTaskQueue.length > 0 && this.idleSolverQueue.length > 0
    }

    this.markTaskInflight(solverId, pendingTask.task)
    this.runTaskOnSolver(solver, solverId, pendingTask)
    return this.pendingTaskQueue.length > 0 && this.idleSolverQueue.length > 0
  }

  private markTaskInflight(solverId: string, task: SolverTask) {
    this.busySolverIds.add(solverId)
    this.inflightTasks.set(solverId, task)
    this.notifyStateChanged()
  }

  private runTaskOnSolver(solver: SolverRunner, solverId: string, pendingTask: PendingSolverTask) {
    void Promise.resolve(solver.solve(pendingTask.task))
      .then((output) => {
        this.releaseSolver(solverId)
        this.scheduleDispatch()

        pendingTask.resolve({
          taskId: pendingTask.task.taskId,
          solverId,
          output,
        })
      })
      .catch((error) => {
        this.releaseSolver(solverId)
        this.scheduleDispatch()
        pendingTask.reject(error)
      })
  }

  private releaseSolver(solverId: string) {
    this.busySolverIds.delete(solverId)
    this.inflightTasks.delete(solverId)

    if (this.solverRegistry.has(solverId)) {
      this.idleSolverQueue.push(solverId)
    }

    this.notifyStateChanged()
  }

  private enqueueRestoredTasks(state: PersistedCTFRuntimeQueueState) {
    const seenTaskIds = new Set<string>()

    // Inflight tasks are re-queued because completion cannot be trusted across restarts.
    for (const task of state.inflightTasks) {
      this.enqueueRestoredTaskIfNeeded(seenTaskIds, {
        taskId: task.taskId,
        payload: task.payload,
      })
    }

    for (const task of state.pendingTasks) {
      this.enqueueRestoredTaskIfNeeded(seenTaskIds, task)
    }
  }

  private enqueueRestoredTaskIfNeeded(
    seenTaskIds: Set<string>,
    task: PersistedCTFRuntimeQueueTask,
  ) {
    if (seenTaskIds.has(task.taskId)) {
      return
    }

    seenTaskIds.add(task.taskId)
    this.enqueueRestoredTask(task)
  }

  private enqueueRestoredTask(task: PersistedCTFRuntimeQueueTask) {
    this.pendingTaskQueue.push({
      task: {
        taskId: task.taskId,
        payload: task.payload,
      },
      resolve: () => {},
      reject: () => {},
    })
  }

  private abortRunningTasks() {
    for (const solverId of this.busySolverIds) {
      this.solverRegistry.get(solverId)?.abortActiveTask?.()
    }
  }

  private notifyStateChanged() {
    this.onStateChanged()
  }
}
