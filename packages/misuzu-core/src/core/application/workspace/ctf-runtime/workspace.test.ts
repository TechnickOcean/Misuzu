import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vite-plus/test"
import { createCTFRuntimeWorkspace } from "../index.ts"

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
