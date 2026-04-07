import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vite-plus/test"
import { getModels } from "@mariozechner/pi-ai"
import {
  createCTFRuntimeWorkspace,
  createCTFRuntimeWorkspaceWithoutPersistence,
} from "./workspace.ts"

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

  test("persists and restores environment agent state before runtime activation", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const defaultModel = getModels("openai")[0]!

    const firstWorkspace = await createCTFRuntimeWorkspace({ rootDir })
    await firstWorkspace.setModelPoolItems([
      {
        provider: defaultModel.provider,
        modelId: defaultModel.id,
        maxConcurrency: 1,
      },
    ])

    const firstEnvironmentAgent = firstWorkspace.createEnvironmentAgent({
      initialState: {
        thinkingLevel: "high",
        systemPrompt: "restore-environment-agent-base-prompt",
      },
    })

    firstEnvironmentAgent.appendMessage({
      role: "user",
      content: "persist-environment-message",
      timestamp: Date.now(),
    })
    await firstWorkspace.persistRuntimeState()
    await firstWorkspace.shutdown()

    const restoredWorkspace = await createCTFRuntimeWorkspace({ rootDir })
    await restoredWorkspace.setModelPoolItems([
      {
        provider: defaultModel.provider,
        modelId: defaultModel.id,
        maxConcurrency: 1,
      },
    ])
    const restoredEnvironmentAgent = restoredWorkspace.createEnvironmentAgent()

    expect(restoredEnvironmentAgent.state.thinkingLevel).toBe("high")
    expect(restoredEnvironmentAgent.state.systemPrompt).toContain(
      "restore-environment-agent-base-prompt",
    )
    expect(restoredEnvironmentAgent.state.messages.length).toBeGreaterThan(0)
    expect(JSON.stringify(restoredEnvironmentAgent.state.messages)).toContain(
      "persist-environment-message",
    )

    await restoredWorkspace.shutdown()
  })

  test("keeps environment agent state after persisting a different runtime", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const defaultModel = getModels("openai")[0]!

    const firstWorkspace = await createCTFRuntimeWorkspace({ rootDir })
    await firstWorkspace.setModelPoolItems([
      {
        provider: defaultModel.provider,
        modelId: defaultModel.id,
        maxConcurrency: 1,
      },
    ])

    const firstEnvironmentAgent = firstWorkspace.createEnvironmentAgent({
      initialState: {
        thinkingLevel: "high",
        systemPrompt: "persist-environment-after-runtime-switch",
      },
    })

    firstEnvironmentAgent.appendMessage({
      role: "user",
      content: "persist-environment-runtime-switch-message",
      timestamp: Date.now(),
    })
    await firstWorkspace.persistRuntimeState()
    await firstWorkspace.shutdown()

    const secondWorkspace = await createCTFRuntimeWorkspace({ rootDir })
    await secondWorkspace.attachRuntime({
      runtimeId: "plugin-runtime",
      getPersistedState: () => ({ runtime: "plugin" }),
    })
    await secondWorkspace.persistRuntimeState()
    await secondWorkspace.shutdown()

    const thirdWorkspace = await createCTFRuntimeWorkspace({ rootDir })
    await thirdWorkspace.setModelPoolItems([
      {
        provider: defaultModel.provider,
        modelId: defaultModel.id,
        maxConcurrency: 1,
      },
    ])

    const restoredEnvironmentAgent = thirdWorkspace.createEnvironmentAgent()
    expect(restoredEnvironmentAgent.state.systemPrompt).toContain(
      "persist-environment-after-runtime-switch",
    )
    expect(JSON.stringify(restoredEnvironmentAgent.state.messages)).toContain(
      "persist-environment-runtime-switch-message",
    )

    await thirdWorkspace.shutdown()
  })

  test("loads runtime options from platformConfigPath and resolves env placeholders", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const workspace = createCTFRuntimeWorkspaceWithoutPersistence({ rootDir })

    const previousEnv = process.env.RUNTIME_BASE_URL
    try {
      process.env.RUNTIME_BASE_URL = "https://runtime-from-env.example.com"

      await mkdir(workspace.markerDir, { recursive: true })
      await writeFile(
        workspace.platformConfigPath,
        JSON.stringify(
          {
            pluginId: "gzctf",
            pluginConfig: {
              baseUrl: "$env:RUNTIME_BASE_URL",
              contest: { mode: "auto" },
              auth: { mode: "manual" },
            },
          },
          null,
          2,
        ),
        "utf-8",
      )

      const runtimeOptions = await workspace.loadRuntimeOptionsFromPlatformConfig()
      expect(runtimeOptions?.pluginId).toBe("gzctf")
      expect(runtimeOptions?.pluginConfig.baseUrl).toBe("https://runtime-from-env.example.com")
    } finally {
      if (previousEnv === undefined) {
        delete process.env.RUNTIME_BASE_URL
      } else {
        process.env.RUNTIME_BASE_URL = previousEnv
      }
    }
  })
})
