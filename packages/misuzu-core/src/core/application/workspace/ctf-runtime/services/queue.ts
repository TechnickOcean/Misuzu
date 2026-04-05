import type {
  PersistedCTFRuntimeInflightTask,
  PersistedCTFRuntimeQueueState,
  PersistedCTFRuntimeQueueTask,
} from "../state.ts"

export interface SolverTask {
  taskId: string
  payload: unknown
}

export interface SolverTaskResult {
  taskId: string
  solverId: string
  output: unknown
}

export interface SolverRunner {
  solverId: string
  solve(task: SolverTask): Promise<unknown>
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

  restoreState(state: PersistedCTFRuntimeQueueState | undefined) {
    if (!state) {
      return
    }

    this.taskSequence = Number.isFinite(state.taskSequence)
      ? Math.max(0, Math.floor(state.taskSequence))
      : 0

    this.pendingTaskQueue.length = 0
    this.inflightTasks.clear()
    const seenTaskIds = new Set<string>()
    for (const task of state.inflightTasks) {
      if (seenTaskIds.has(task.taskId)) {
        continue
      }

      seenTaskIds.add(task.taskId)
      this.enqueueRestoredTask({ taskId: task.taskId, payload: task.payload })
    }

    for (const task of state.pendingTasks) {
      if (seenTaskIds.has(task.taskId)) {
        continue
      }

      seenTaskIds.add(task.taskId)
      this.enqueueRestoredTask(task)
    }

    this.notifyStateChanged()
    this.scheduleDispatch()
  }

  snapshotState(): PersistedCTFRuntimeQueueState {
    return {
      taskSequence: this.taskSequence,
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
      pendingTaskCount: this.pendingTaskQueue.length,
      idleSolverCount: this.idleSolverQueue.length,
      busySolverCount: this.busySolverIds.size,
      registeredSolverCount: this.solverRegistry.size,
    }
  }

  private nextTaskId() {
    this.taskSequence += 1
    return `task-${this.taskSequence}`
  }

  private scheduleDispatch() {
    while (this.pendingTaskQueue.length > 0 && this.idleSolverQueue.length > 0) {
      const pendingTask = this.pendingTaskQueue.shift()
      const solverId = this.idleSolverQueue.shift()

      if (!pendingTask || !solverId) {
        return
      }

      const solver = this.solverRegistry.get(solverId)
      if (!solver) {
        continue
      }

      this.busySolverIds.add(solverId)
      this.inflightTasks.set(solverId, pendingTask.task)
      this.notifyStateChanged()

      void Promise.resolve(solver.solve(pendingTask.task))
        .then((output) => {
          pendingTask.resolve({
            taskId: pendingTask.task.taskId,
            solverId,
            output,
          })
        })
        .catch((error) => {
          pendingTask.reject(error)
        })
        .finally(() => {
          this.busySolverIds.delete(solverId)
          this.inflightTasks.delete(solverId)

          if (this.solverRegistry.has(solverId)) {
            this.idleSolverQueue.push(solverId)
          }

          this.notifyStateChanged()
          this.scheduleDispatch()
        })
    }
  }

  private enqueueRestoredTask(
    task: PersistedCTFRuntimeQueueTask | PersistedCTFRuntimeInflightTask,
  ) {
    this.pendingTaskQueue.push({
      task: {
        taskId: task.taskId,
        payload: task.payload,
      },
      resolve: () => {},
      reject: () => {},
    })
  }

  private notifyStateChanged() {
    this.onStateChanged()
  }
}
