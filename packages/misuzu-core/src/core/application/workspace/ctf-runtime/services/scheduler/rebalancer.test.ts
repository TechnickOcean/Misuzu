import { describe, expect, test } from "vite-plus/test"
import type { PersistedCTFRuntimeManagedChallenge } from "../../state.ts"
import { RuntimeRankOrchestrator } from "./rebalancer.ts"
import type { DispatchTask, SolverTaskResult } from "./queue.ts"

interface ProgressState {
  challengeId: number
  status: "idle" | "writeup_required" | "solved" | "blocked"
}

interface RebalancerHarnessOptions {
  managedChallenges: PersistedCTFRuntimeManagedChallenge[]
  progressStates?: ProgressState[]
  registeredSolverCount?: number
  modelTotalAvailable?: number
  modelTotalCapacity?: number
  maxConcurrentContainers?: number
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolveFn, rejectFn) => {
    resolve = resolveFn
    reject = rejectFn
  })

  return {
    promise,
    resolve,
    reject,
  }
}

function createManagedChallenge(input: {
  challengeId: number
  category: string
  requiresContainer: boolean
}): PersistedCTFRuntimeManagedChallenge {
  return {
    challengeId: input.challengeId,
    solverId: `solver-${String(input.challengeId)}`,
    title: `challenge-${String(input.challengeId)}`,
    category: input.category,
    requiresContainer: input.requiresContainer,
    score: 100,
    solvedCount: 0,
  }
}

function createRebalancerHarness(options: RebalancerHarnessOptions) {
  let managedChallenges = [...options.managedChallenges]
  let progressStates = [...(options.progressStates ?? [])]
  let modelTotalAvailable =
    options.modelTotalAvailable ?? options.modelTotalCapacity ?? options.managedChallenges.length
  let modelTotalCapacity = options.modelTotalCapacity ?? modelTotalAvailable
  let maxConcurrentContainers = options.maxConcurrentContainers ?? Number.POSITIVE_INFINITY

  const startedChallengeIds: number[] = []
  const inflightTasksById = new Map<string, DispatchTask>()
  const deferredResultsByTaskId = new Map<string, Deferred<SolverTaskResult>>()

  const orchestrator = new RuntimeRankOrchestrator({
    listManagedChallenges: () => managedChallenges,
    listSolverProgressStates: () => progressStates,
    getSchedulerState: () => ({
      registeredSolverCount: options.registeredSolverCount ?? managedChallenges.length,
    }),
    getModelPoolState: () => ({
      totalCapacity: modelTotalCapacity,
      totalAvailable: modelTotalAvailable,
    }),
    getDispatchLimits: () => ({
      maxConcurrentContainers,
    }),
    listInflightDispatchTasks: () => [...inflightTasksById.values()],
    runDispatchTask: async (task) => {
      startedChallengeIds.push(task.challengeId)
      inflightTasksById.set(task.taskId, task)

      const deferred = createDeferred<SolverTaskResult>()
      deferredResultsByTaskId.set(task.taskId, deferred)
      return deferred.promise.finally(() => {
        inflightTasksById.delete(task.taskId)
        deferredResultsByTaskId.delete(task.taskId)
      })
    },
    cancelInflightTask: (taskId) => {
      const deferred = deferredResultsByTaskId.get(taskId)
      if (!deferred) {
        return undefined
      }

      deferred.reject(new Error(`cancelled ${taskId}`))
      return "inflight"
    },
    abortAllRunningTasks: () => {
      for (const [taskId, deferred] of deferredResultsByTaskId) {
        deferred.reject(new Error(`aborted ${taskId}`))
      }
    },
    setUnexpectedSolverStopListener: () => {},
    notifyStateChanged: () => {},
  })

  return {
    orchestrator,
    startedChallengeIds,
    setManagedChallenges(next: PersistedCTFRuntimeManagedChallenge[]) {
      managedChallenges = [...next]
    },
    setProgressStates(next: ProgressState[]) {
      progressStates = [...next]
    },
    setModelAvailability(next: number) {
      modelTotalAvailable = next
      modelTotalCapacity = Math.max(modelTotalCapacity, next)
    },
    setContainerLimit(next: number) {
      maxConcurrentContainers = next
    },
    resolveAllInflight() {
      for (const [taskId, deferred] of deferredResultsByTaskId) {
        deferred.resolve({
          taskId,
          solverId: inflightTasksById.get(taskId)?.targetSolverId ?? "solver-unknown",
          output: {},
        })
      }
    },
  }
}

async function settleRebalance(ms = 25) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

describe("runtime rank orchestrator", () => {
  test("limits auto-dispatch target by available model slots", async () => {
    const harness = createRebalancerHarness({
      managedChallenges: [
        createManagedChallenge({ challengeId: 1, category: "misc", requiresContainer: false }),
        createManagedChallenge({ challengeId: 2, category: "web", requiresContainer: false }),
        createManagedChallenge({ challengeId: 3, category: "pwn", requiresContainer: false }),
      ],
      registeredSolverCount: 3,
      modelTotalCapacity: 3,
      modelTotalAvailable: 1,
    })

    harness.orchestrator.initialize()
    harness.orchestrator.setDispatchAutoManaged(true)
    harness.orchestrator.scheduleRebalance(true)
    await settleRebalance()

    expect(harness.startedChallengeIds.length).toBe(1)
    harness.orchestrator.dispose()
  })

  test("enforces container concurrency cap while filling non-container slots", async () => {
    const harness = createRebalancerHarness({
      managedChallenges: [
        createManagedChallenge({ challengeId: 1, category: "web", requiresContainer: true }),
        createManagedChallenge({ challengeId: 2, category: "pwn", requiresContainer: true }),
        createManagedChallenge({ challengeId: 3, category: "misc", requiresContainer: false }),
        createManagedChallenge({ challengeId: 4, category: "crypto", requiresContainer: false }),
      ],
      registeredSolverCount: 4,
      modelTotalCapacity: 4,
      modelTotalAvailable: 4,
      maxConcurrentContainers: 1,
    })

    harness.orchestrator.initialize()
    harness.orchestrator.setDispatchAutoManaged(true)
    harness.orchestrator.scheduleRebalance(true)
    await settleRebalance()

    const containerChallengeIds = new Set([1, 2])
    const containerStarts = harness.startedChallengeIds.filter((id) =>
      containerChallengeIds.has(id),
    )

    expect(containerStarts.length).toBe(1)
    expect(harness.startedChallengeIds.length).toBe(3)
    harness.orchestrator.dispose()
  })

  test("recomputes auto intent priority from latest challenge metadata before dispatch", async () => {
    const harness = createRebalancerHarness({
      managedChallenges: [
        createManagedChallenge({ challengeId: 1, category: "misc", requiresContainer: false }),
        createManagedChallenge({ challengeId: 2, category: "pwn", requiresContainer: true }),
      ],
      registeredSolverCount: 2,
      modelTotalCapacity: 2,
      modelTotalAvailable: 0,
      maxConcurrentContainers: 1,
    })

    harness.orchestrator.initialize()
    harness.orchestrator.setDispatchAutoManaged(true)
    harness.orchestrator.scheduleRebalance(true)
    await settleRebalance()

    expect(harness.startedChallengeIds).toEqual([])

    harness.setManagedChallenges([
      createManagedChallenge({ challengeId: 1, category: "web", requiresContainer: false }),
      createManagedChallenge({ challengeId: 2, category: "pwn", requiresContainer: true }),
    ])
    harness.orchestrator.onManagedChallengesChanged()
    harness.setModelAvailability(1)
    harness.orchestrator.scheduleRebalance(true)
    await settleRebalance()

    expect(harness.startedChallengeIds[0]).toBe(1)
    harness.orchestrator.dispose()
  })

  test("keeps manual intents even when challenge is solved", async () => {
    const harness = createRebalancerHarness({
      managedChallenges: [
        createManagedChallenge({ challengeId: 1, category: "crypto", requiresContainer: true }),
      ],
      progressStates: [{ challengeId: 1, status: "solved" }],
      registeredSolverCount: 1,
      modelTotalCapacity: 1,
      modelTotalAvailable: 0,
      maxConcurrentContainers: 1,
    })

    harness.orchestrator.initialize()
    harness.orchestrator.createManualIntent({ challenge: 1 }, "manual-1")
    harness.orchestrator.scheduleRebalance(true)
    await settleRebalance()

    expect(
      harness.orchestrator.listPendingIntentsSnapshot().map((intent) => intent.taskId),
    ).toEqual(["manual-1"])

    harness.setModelAvailability(1)
    harness.orchestrator.scheduleRebalance(true)
    await settleRebalance()

    expect(harness.startedChallengeIds).toEqual([1])
    harness.orchestrator.dispose()
  })
})
