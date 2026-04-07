import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vite-plus/test"
import { createCTFRuntimeWorkspaceWithoutPersistence } from "../../workspace.ts"
import { QueueService } from "./queue.ts"

const tempDirs: string[] = []

async function createRuntimeWorkspaceDir() {
  const dir = await mkdtemp(join(tmpdir(), "misuzu-ctf-runtime-"))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

describe("ctf runtime fifo scheduler", () => {
  test("dispatches queued tasks in FIFO order", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const workspace = createCTFRuntimeWorkspaceWithoutPersistence({ rootDir })

    const observedTaskIds: string[] = []
    workspace.registerSolver({
      solverId: "solver-1",
      solve: async (task) => {
        observedTaskIds.push(task.taskId)
        return `done:${task.taskId}`
      },
    })

    const first = workspace.enqueueTask({ challenge: "a" }, "task-1")
    const second = workspace.enqueueTask({ challenge: "b" }, "task-2")
    const third = workspace.enqueueTask({ challenge: "c" }, "task-3")

    const results = await Promise.all([first, second, third])

    expect(observedTaskIds).toEqual(["task-1", "task-2", "task-3"])
    expect(results.map((result) => result.taskId)).toEqual(["task-1", "task-2", "task-3"])
    expect(results.map((result) => result.solverId)).toEqual(["solver-1", "solver-1", "solver-1"])
  })

  test("keeps task order when tasks arrive before solver registration", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const workspace = createCTFRuntimeWorkspaceWithoutPersistence({ rootDir })

    const observedTaskIds: string[] = []
    const first = workspace.enqueueTask({ challenge: "a" }, "task-1")
    const second = workspace.enqueueTask({ challenge: "b" }, "task-2")

    workspace.registerSolver({
      solverId: "solver-late",
      solve: async (task) => {
        observedTaskIds.push(task.taskId)
        return task.payload
      },
    })

    const results = await Promise.all([first, second])

    expect(observedTaskIds).toEqual(["task-1", "task-2"])
    expect(results.map((result) => result.taskId)).toEqual(["task-1", "task-2"])
  })

  test("pauses and resumes task dispatch without dropping queued tasks", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const workspace = createCTFRuntimeWorkspaceWithoutPersistence({ rootDir })

    const observedTaskIds: string[] = []
    workspace.pauseTaskDispatch()
    workspace.registerSolver({
      solverId: "solver-paused",
      solve: async (task) => {
        observedTaskIds.push(task.taskId)
        return task.payload
      },
    })

    const firstTask = workspace.enqueueTask({ challenge: "paused" }, "task-paused")

    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(observedTaskIds).toEqual([])
    expect(workspace.getSchedulerState().paused).toBe(true)

    workspace.resumeTaskDispatch()
    await firstTask

    expect(observedTaskIds).toEqual(["task-paused"])
    expect(workspace.getSchedulerState().paused).toBe(false)
  })

  test("retries active solver task after pause and resume", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const workspace = createCTFRuntimeWorkspaceWithoutPersistence({ rootDir })

    const observedTaskIds: string[] = []
    let rejectActiveTask: ((error?: unknown) => void) | undefined
    let activeTaskAttempt = 0

    workspace.registerSolver({
      solverId: "solver-abort",
      solve: async (task) => {
        observedTaskIds.push(task.taskId)
        if (task.taskId === "task-active") {
          activeTaskAttempt += 1
          if (activeTaskAttempt === 1) {
            return new Promise((_resolve, reject) => {
              rejectActiveTask = reject
            })
          }
        }

        return `done:${task.taskId}`
      },
      abortActiveTask: () => {
        rejectActiveTask?.(new Error("task aborted"))
      },
    })

    const activeTask = workspace.enqueueTask({ challenge: "active" }, "task-active")
    const queuedTask = workspace.enqueueTask({ challenge: "queued" }, "task-queued")

    await new Promise((resolve) => setTimeout(resolve, 30))
    workspace.pauseTaskDispatch()

    let activeTaskSettled = false
    void activeTask.finally(() => {
      activeTaskSettled = true
    })

    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(observedTaskIds).toEqual(["task-active"])
    expect(workspace.getSchedulerState().paused).toBe(true)
    expect(activeTaskSettled).toBe(false)

    workspace.resumeTaskDispatch()
    await expect(activeTask).resolves.toMatchObject({ taskId: "task-active" })
    await expect(queuedTask).resolves.toMatchObject({ taskId: "task-queued" })
    expect(observedTaskIds).toEqual(["task-active", "task-queued", "task-active"])
  })

  test("cancels pending scheduler task by task id", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const workspace = createCTFRuntimeWorkspaceWithoutPersistence({ rootDir })

    workspace.pauseTaskDispatch()

    workspace.registerSolver({
      solverId: "solver-cancel-pending",
      solve: async () => "done",
    })

    const pendingTask = workspace.enqueueTask({ challenge: "cancel" }, "task-cancel-pending")

    const cancelled = workspace.cancelSchedulerTask("task-cancel-pending")
    expect(cancelled).toBe("pending")
    await expect(pendingTask).rejects.toThrow("Task cancelled")
  })

  test("cancels inflight scheduler task by task id", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const workspace = createCTFRuntimeWorkspaceWithoutPersistence({ rootDir })

    let rejectActiveTask: ((error?: unknown) => void) | undefined
    workspace.registerSolver({
      solverId: "solver-cancel-inflight",
      solve: async () =>
        new Promise((_resolve, reject) => {
          rejectActiveTask = reject
        }),
      abortActiveTask: () => {
        rejectActiveTask?.(new Error("task aborted by cancel"))
      },
    })

    const inflightTask = workspace.enqueueTask({ challenge: "cancel" }, "task-cancel-inflight")
    await new Promise((resolve) => setTimeout(resolve, 30))

    const cancelled = workspace.cancelSchedulerTask("task-cancel-inflight")
    expect(cancelled).toBe("inflight")
    await expect(inflightTask).rejects.toThrow("task aborted by cancel")
  })

  test("keeps deferred tasks pending during resume until solver becomes dispatchable", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const workspace = createCTFRuntimeWorkspaceWithoutPersistence({ rootDir })

    workspace.pauseTaskDispatch()

    const observedTaskIds: string[] = []
    let releaseFirstTask: (() => void) | undefined
    let allowSecondSolverDispatch = false

    workspace.registerSolver({
      solverId: "solver-1",
      solve: async (task) => {
        observedTaskIds.push(`solver-1:${task.taskId}`)
        await new Promise<void>((resolve) => {
          releaseFirstTask = resolve
        })
        return task.payload
      },
    })

    const deferredSolver = {
      solverId: "solver-2",
      prepareTask: () =>
        allowSecondSolverDispatch ? { status: "ready" as const } : { status: "deferred" as const },
      solve: async (task: { taskId: string; payload: unknown }) => {
        observedTaskIds.push(`solver-2:${task.taskId}`)
        return task.payload
      },
    }
    workspace.registerSolver(deferredSolver)

    const firstTask = workspace.enqueueTask({ challenge: "a" }, "task-1")
    const secondTask = workspace.enqueueTask({ challenge: "b" }, "task-2")

    workspace.resumeTaskDispatch()

    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(observedTaskIds).toEqual(["solver-1:task-1"])

    allowSecondSolverDispatch = true
    releaseFirstTask?.()

    await expect(firstTask).resolves.toMatchObject({ taskId: "task-1" })
    await expect(secondTask).resolves.toMatchObject({ taskId: "task-2" })
    expect(observedTaskIds).toEqual(["solver-1:task-1", "solver-2:task-2"])
  })

  test("keeps restored tasks pending when solver dispatch is deferred", async () => {
    const queue = new QueueService()
    const observedTaskIds: string[] = []
    let allowDispatch = false

    const deferredSolver = {
      solverId: "solver-restore",
      prepareTask: () =>
        allowDispatch ? { status: "ready" as const } : { status: "deferred" as const },
      solve: async (task: { taskId: string; payload: unknown }) => {
        observedTaskIds.push(task.taskId)
        return task.payload
      },
    }

    queue.registerSolver(deferredSolver)
    queue.restoreState({
      taskSequence: 2,
      paused: false,
      pendingTasks: [{ taskId: "task-1", payload: { challenge: 1 } }],
      inflightTasks: [{ solverId: "solver-restore", taskId: "task-2", payload: { challenge: 2 } }],
    })

    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(observedTaskIds).toEqual([])
    expect(queue.listPendingTasks().map((task) => task.taskId)).toEqual(["task-2", "task-1"])

    allowDispatch = true
    queue.wake()

    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(observedTaskIds).toEqual(["task-2", "task-1"])
    expect(queue.listPendingTasks()).toEqual([])
  })
})
