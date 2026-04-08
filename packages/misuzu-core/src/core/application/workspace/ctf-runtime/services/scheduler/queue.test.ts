import { describe, expect, test } from "vite-plus/test"
import { QueueService, type DispatchTask } from "./queue.ts"

function createDispatchTask(
  taskId: string,
  challengeId: number,
  targetSolverId: string,
): DispatchTask {
  return {
    taskId,
    challengeId,
    targetSolverId,
    payload: { challenge: challengeId },
    source: "manual",
    priority: 1,
    createdAt: Date.now(),
  }
}

describe("queue execution engine", () => {
  test("runs a dispatch task on targeted solver", async () => {
    const queue = new QueueService()
    const observed: string[] = []

    queue.registerSolver({
      solverId: "solver-1",
      solve: async (task) => {
        observed.push(task.taskId)
        return { ok: true }
      },
    })

    const result = await queue.runTask(createDispatchTask("task-1", 1, "solver-1"))
    expect(observed).toEqual(["task-1"])
    expect(result).toMatchObject({ taskId: "task-1", solverId: "solver-1" })
  })

  test("rejects run when target solver is missing", async () => {
    const queue = new QueueService()
    expect(() => queue.runTask(createDispatchTask("task-missing", 1, "solver-missing"))).toThrow(
      "solver is not registered",
    )
  })

  test("cancels inflight task via solver abort callback", async () => {
    const queue = new QueueService()
    let rejectActiveTask: ((error?: unknown) => void) | undefined

    queue.registerSolver({
      solverId: "solver-2",
      solve: async () =>
        new Promise((_resolve, reject) => {
          rejectActiveTask = reject
        }),
      abortActiveTask: () => {
        rejectActiveTask?.(new Error("aborted"))
      },
    })

    const runningTask = queue.runTask(createDispatchTask("task-2", 2, "solver-2"))
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(queue.cancelTask("task-2")).toBe("inflight")
    await expect(runningTask).rejects.toThrow("aborted")
  })

  test("restores legacy queue snapshot into pending dispatch tasks", () => {
    const queue = new QueueService()

    const restored = queue.restoreQueueTasksAsPendingTasks({
      taskSequence: 2,
      paused: false,
      pendingTasks: [{ taskId: "task-1", payload: { challenge: 1 }, targetSolverId: "solver-1" }],
      inflightTasks: [{ solverId: "solver-2", taskId: "task-2", payload: { challenge: 2 } }],
    })

    expect(restored.map((task) => task.taskId)).toEqual(["task-2", "task-1"])
    expect(restored.map((task) => task.targetSolverId)).toEqual(["solver-2", "solver-1"])
    expect(restored.map((task) => task.challengeId)).toEqual([2, 1])
  })
})
