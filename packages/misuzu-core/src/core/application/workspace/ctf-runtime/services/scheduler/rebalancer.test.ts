import { describe, expect, test } from "vite-plus/test"
import { RuntimeRankOrchestrator } from "./rebalancer.ts"

describe("runtime rank orchestrator", () => {
  test("limits auto-enqueue target by currently available model slots", async () => {
    const enqueuedChallengeIds: number[] = []

    const orchestrator = new RuntimeRankOrchestrator({
      listManagedChallenges: () => [
        {
          challengeId: 1,
          solverId: "solver-1",
          title: "one",
          category: "misc",
          score: 100,
          solvedCount: 0,
        },
        {
          challengeId: 2,
          solverId: "solver-2",
          title: "two",
          category: "web",
          score: 100,
          solvedCount: 0,
        },
        {
          challengeId: 3,
          solverId: "solver-3",
          title: "three",
          category: "pwn",
          score: 100,
          solvedCount: 0,
        },
      ],
      getChallengeSolver: () => ({}) as object,
      listSolverProgressStates: () => [],
      listPendingSchedulerTasks: () => [],
      listInflightSchedulerTasks: () => [],
      cancelSchedulerTask: () => undefined,
      enqueueTask: (payload) => {
        const challengeId = (payload as { challenge?: unknown }).challenge
        if (typeof challengeId === "number") {
          enqueuedChallengeIds.push(challengeId)
        }

        // Keep auto-queued tasks in-flight for this unit test to avoid immediate settle requeue loops.
        return new Promise(() => {})
      },
      getSchedulerState: () => ({ registeredSolverCount: 3 }),
      getModelPoolState: () => ({ totalCapacity: 3, totalAvailable: 1 }),
      isTaskDispatchPaused: () => false,
      setUnexpectedSolverStopListener: () => {},
      notifyStateChanged: () => {},
    })

    orchestrator.setDispatchAutoManaged(true)
    orchestrator.scheduleRebalance(true)

    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(enqueuedChallengeIds.length).toBe(1)
  })
})
