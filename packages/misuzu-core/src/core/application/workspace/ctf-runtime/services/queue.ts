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

export class QueueService {
  private readonly solverRegistry = new Map<string, SolverRunner>()
  private readonly pendingTaskQueue: PendingSolverTask[] = []
  private readonly idleSolverQueue: string[] = []
  private readonly busySolverIds = new Set<string>()
  private taskSequence = 0

  registerSolver(solver: SolverRunner) {
    if (this.solverRegistry.has(solver.solverId)) {
      throw new Error(`Solver already registered: ${solver.solverId}`)
    }

    this.solverRegistry.set(solver.solverId, solver)
    this.idleSolverQueue.push(solver.solverId)
    this.scheduleDispatch()
  }

  unregisterSolver(solverId: string) {
    this.solverRegistry.delete(solverId)

    const solverIndex = this.idleSolverQueue.indexOf(solverId)
    if (solverIndex >= 0) {
      this.idleSolverQueue.splice(solverIndex, 1)
    }
  }

  enqueueTask(payload: unknown, taskId = this.nextTaskId()) {
    const task: SolverTask = { taskId, payload }

    return new Promise<SolverTaskResult>((resolve, reject) => {
      this.pendingTaskQueue.push({ task, resolve, reject })
      this.scheduleDispatch()
    })
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

          if (this.solverRegistry.has(solverId)) {
            this.idleSolverQueue.push(solverId)
          }

          this.scheduleDispatch()
        })
    }
  }
}
