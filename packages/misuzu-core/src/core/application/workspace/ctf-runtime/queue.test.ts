import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vite-plus/test"
import { createCTFRuntimeWorkspaceWithoutPersistence } from "../index.ts"

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

  test("aborts active solver task when queue is paused", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const workspace = createCTFRuntimeWorkspaceWithoutPersistence({ rootDir })

    const observedTaskIds: string[] = []
    let rejectActiveTask: ((error?: unknown) => void) | undefined

    workspace.registerSolver({
      solverId: "solver-abort",
      solve: async (task) => {
        observedTaskIds.push(task.taskId)
        if (task.taskId === "task-active") {
          return new Promise((_resolve, reject) => {
            rejectActiveTask = reject
          })
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

    await expect(activeTask).rejects.toThrow("task aborted")
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(observedTaskIds).toEqual(["task-active"])
    expect(workspace.getSchedulerState().paused).toBe(true)

    workspace.resumeTaskDispatch()
    await expect(queuedTask).resolves.toMatchObject({ taskId: "task-queued" })
    expect(observedTaskIds).toEqual(["task-active", "task-queued"])
  })
})
