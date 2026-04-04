import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vite-plus/test"
import { getModels } from "@mariozechner/pi-ai"
import { createCTFRuntimeWorkspace, createCTFRuntimeWorkspaceWithoutPersistence } from "../index.ts"

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

describe("ctf runtime workspace persistence", () => {
  test("persists and restores runtime state", async () => {
    const rootDir = await createRuntimeWorkspaceDir()

    const runtimeWorkspace = await createCTFRuntimeWorkspace({ rootDir })
    const snapshot = {
      queue: ["challenge-1", "challenge-2"],
      limits: { maxConcurrency: 2, maxContainers: 1 },
    }

    await runtimeWorkspace.attachRuntime({
      runtimeId: "ctf-runtime",
      getPersistedState: () => snapshot,
    })
    await runtimeWorkspace.persistRuntimeState()
    await runtimeWorkspace.shutdown()

    const restoredWorkspace = await createCTFRuntimeWorkspace({ rootDir })
    let restoredPayload: Record<string, unknown> | undefined

    await restoredWorkspace.attachRuntime({
      runtimeId: "ctf-runtime",
      getPersistedState: () => ({}),
      restoreFromPersistedState: async (payload) => {
        restoredPayload = payload
      },
    })

    expect(restoredPayload).toEqual(snapshot)
  })

  test("ignores persisted state when runtime id mismatches", async () => {
    const rootDir = await createRuntimeWorkspaceDir()

    const runtimeWorkspace = await createCTFRuntimeWorkspace({ rootDir })
    await runtimeWorkspace.attachRuntime({
      runtimeId: "runtime-a",
      getPersistedState: () => ({ marker: "a" }),
    })
    await runtimeWorkspace.persistRuntimeState()
    await runtimeWorkspace.shutdown()

    const restoredWorkspace = await createCTFRuntimeWorkspace({ rootDir })
    let restoredCalled = false

    await restoredWorkspace.attachRuntime({
      runtimeId: "runtime-b",
      getPersistedState: () => ({}),
      restoreFromPersistedState: async () => {
        restoredCalled = true
      },
    })

    expect(restoredCalled).toBe(false)
  })
})

describe("ctf runtime providers", () => {
  test("bootstraps provider config once", async () => {
    const sourceModel = getModels("openai")[0]
    expect(sourceModel).toBeDefined()

    const rootDir = await createRuntimeWorkspaceDir()
    const workspace = createCTFRuntimeWorkspaceWithoutPersistence({ rootDir })

    await mkdir(workspace.markerDir, { recursive: true })
    await writeFile(
      workspace.providerConfigPath,
      JSON.stringify(
        [
          {
            provider: `ctf-proxy-${Date.now()}`,
            baseProvider: "openai",
            modelMappings: [sourceModel!.id],
          },
        ],
        null,
        2,
      ),
      "utf-8",
    )

    const firstLoad = workspace.bootstrapProviders()
    const secondLoad = workspace.bootstrapProviders()

    expect(firstLoad.length).toBe(1)
    expect(secondLoad.length).toBe(0)
  })
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
})
