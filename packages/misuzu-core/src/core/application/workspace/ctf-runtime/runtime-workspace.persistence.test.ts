import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vite-plus/test"
import { getModels } from "@mariozechner/pi-ai"
import type {
  ChallengeDetail,
  ChallengeSummary,
  CTFPlatformPlugin,
  PluginConfig,
} from "../../../../../plugins/index.ts"
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

function resolveDefaultPoolItem(maxConcurrency = 1) {
  const defaultModel = getModels("openai")[0]
  if (!defaultModel) {
    throw new Error("OpenAI default model is missing for persistence test setup")
  }

  return {
    provider: defaultModel.provider,
    modelId: defaultModel.id,
    maxConcurrency,
  }
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

class PersistenceMockPlugin implements CTFPlatformPlugin {
  readonly meta = {
    id: "mock-platform-persistence",
    name: "Mock Platform Persistence",
  }

  private readonly challenge: ChallengeSummary = {
    id: 901,
    title: "persisted-queue",
    category: "misc",
    score: 100,
    solvedCount: 0,
  }

  constructor(private readonly includeChallengeInListing = true) {}

  async setup(_config: PluginConfig) {}

  async login() {
    return {
      mode: "manual" as const,
      cookie: "sid=mock",
      refreshable: false,
    }
  }

  async validateSession(session: { cookie?: string }) {
    if (session.cookie !== "sid=mock") {
      throw new Error("invalid session")
    }
  }

  async listContests(session: { cookie?: string }) {
    if (session.cookie !== "sid=mock") {
      throw new Error("invalid session")
    }

    return [{ id: 1, title: "Mock Contest" }]
  }

  async listChallenges(context: { session: { cookie?: string }; contestId: number }) {
    if (context.session.cookie !== "sid=mock" || context.contestId !== 1) {
      throw new Error("invalid context")
    }

    return this.includeChallengeInListing ? [this.challenge] : []
  }

  async getChallenge(context: {
    session: { cookie?: string }
    contestId: number
    challengeId: number
  }): Promise<ChallengeDetail> {
    if (
      context.session.cookie !== "sid=mock" ||
      context.contestId !== 1 ||
      context.challengeId !== this.challenge.id
    ) {
      throw new Error("invalid context")
    }

    return {
      id: this.challenge.id,
      title: this.challenge.title,
      category: this.challenge.category,
      score: this.challenge.score,
      content: "persisted challenge",
      hints: [],
      requiresContainer: false,
      attempts: 0,
      attachments: [],
    }
  }

  async submitFlagRaw(context: {
    session: { cookie?: string }
    contestId: number
    challengeId: number
    flag: string
  }) {
    if (
      context.session.cookie !== "sid=mock" ||
      context.contestId !== 1 ||
      context.challengeId !== this.challenge.id
    ) {
      throw new Error("invalid context")
    }

    return {
      submissionId: 1,
      status: context.flag,
      accepted: context.flag.includes("accepted"),
    }
  }

  async pollUpdates() {
    return {
      cursor: "1",
      updates: [],
    }
  }
}

describe("ctf runtime workspace persistence", () => {
  test("restores attached runtime payload when runtime id matches", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const runtimeWorkspace = await createCTFRuntimeWorkspace({ rootDir })
    const runtimePayload = {
      autoOrchestrate: true,
      pluginConfig: {
        baseUrl: "https://example.com",
        contest: { mode: "auto" },
        maxConcurrentContainers: 2,
      },
    }

    await runtimeWorkspace.attachRuntime({
      runtimeId: "ctf-runtime",
      getPersistedState: () => runtimePayload,
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

    expect(restoredPayload).toEqual(runtimePayload)
    await restoredWorkspace.shutdown()
  })

  test("does not restore attached runtime payload when runtime id differs", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const runtimeWorkspace = await createCTFRuntimeWorkspace({ rootDir })

    await runtimeWorkspace.attachRuntime({
      runtimeId: "runtime-a",
      getPersistedState: () => ({ marker: "runtime-a" }),
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
    await restoredWorkspace.shutdown()
  })

  test("restores environment agent state for skip-plugin setup flow", async () => {
    const rootDir = await createRuntimeWorkspaceDir()

    const firstWorkspace = await createCTFRuntimeWorkspace({ rootDir })
    await firstWorkspace.setModelPoolItems([resolveDefaultPoolItem()])

    const firstEnvironmentAgent = firstWorkspace.createEnvironmentAgent({
      initialState: {
        thinkingLevel: "high",
        systemPrompt: "environment-before-plugin",
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
    await restoredWorkspace.setModelPoolItems([resolveDefaultPoolItem()])

    const restoredEnvironmentAgent = restoredWorkspace.createEnvironmentAgent()
    expect(restoredEnvironmentAgent.state.thinkingLevel).toBe("high")
    expect(restoredEnvironmentAgent.state.systemPrompt).toContain("environment-before-plugin")
    expect(JSON.stringify(restoredEnvironmentAgent.state.messages)).toContain(
      "persist-environment-message",
    )

    await restoredWorkspace.shutdown()
  })

  test("keeps environment snapshot after runtime plugin persistence", async () => {
    const rootDir = await createRuntimeWorkspaceDir()

    const firstWorkspace = await createCTFRuntimeWorkspace({ rootDir })
    await firstWorkspace.setModelPoolItems([resolveDefaultPoolItem()])

    const environmentAgent = firstWorkspace.createEnvironmentAgent({
      initialState: {
        systemPrompt: "environment-survives-runtime",
      },
    })
    environmentAgent.appendMessage({
      role: "user",
      content: "persist-before-runtime-attach",
      timestamp: Date.now(),
    })
    await firstWorkspace.persistRuntimeState()
    await firstWorkspace.shutdown()

    const secondWorkspace = await createCTFRuntimeWorkspace({ rootDir })
    await secondWorkspace.attachRuntime({
      runtimeId: "plugin-runtime",
      getPersistedState: () => ({ ok: true }),
    })
    await secondWorkspace.persistRuntimeState()
    await secondWorkspace.shutdown()

    const thirdWorkspace = await createCTFRuntimeWorkspace({ rootDir })
    await thirdWorkspace.setModelPoolItems([resolveDefaultPoolItem()])
    const restoredEnvironmentAgent = thirdWorkspace.createEnvironmentAgent()

    expect(restoredEnvironmentAgent.state.systemPrompt).toContain("environment-survives-runtime")
    expect(JSON.stringify(restoredEnvironmentAgent.state.messages)).toContain(
      "persist-before-runtime-attach",
    )
    await thirdWorkspace.shutdown()
  })

  test("restores paused queue intents after workspace reopen", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const runtimeOptions = {
      plugin: new PersistenceMockPlugin(),
      pluginConfig: {
        baseUrl: "https://example.com",
        contest: { mode: "auto" as const },
        auth: { mode: "manual" as const },
        maxConcurrentContainers: 1,
      },
      startPaused: true,
    }

    const firstWorkspace = await createCTFRuntimeWorkspace({ rootDir, runtime: runtimeOptions })
    await firstWorkspace.setModelPoolItems([resolveDefaultPoolItem(1)])

    void firstWorkspace.enqueueTask({ challenge: 901 }, "task-persisted").catch(() => {})
    expect(firstWorkspace.listPendingSchedulerTasks().map((task) => task.taskId)).toContain(
      "task-persisted",
    )

    await firstWorkspace.shutdown()

    const restoredWorkspace = await createCTFRuntimeWorkspace({
      rootDir,
      runtime: {
        ...runtimeOptions,
        plugin: new PersistenceMockPlugin(),
      },
    })
    await restoredWorkspace.setModelPoolItems([resolveDefaultPoolItem(1)])

    expect(restoredWorkspace.getChallengeSolver(901)).toBeDefined()
    expect(restoredWorkspace.listPendingSchedulerTasks().map((task) => task.taskId)).toContain(
      "task-persisted",
    )
    await restoredWorkspace.shutdown()
  })

  test("persists manual blocked solver state across workspace reopen", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const runtimeOptions = {
      plugin: new PersistenceMockPlugin(),
      pluginConfig: {
        baseUrl: "https://example.com",
        contest: { mode: "auto" as const },
        auth: { mode: "manual" as const },
        maxConcurrentContainers: 1,
      },
      startPaused: true,
    }

    const firstWorkspace = await createCTFRuntimeWorkspace({ rootDir, runtime: runtimeOptions })
    await firstWorkspace.setModelPoolItems([resolveDefaultPoolItem(1)])

    expect(firstWorkspace.blockChallengeSolver(901)).toBe(true)
    expect(firstWorkspace.isChallengeManuallyBlocked(901)).toBe(true)

    await firstWorkspace.shutdown()

    const restoredWorkspace = await createCTFRuntimeWorkspace({
      rootDir,
      runtime: {
        ...runtimeOptions,
        plugin: new PersistenceMockPlugin(),
      },
    })
    await restoredWorkspace.setModelPoolItems([resolveDefaultPoolItem(1)])

    expect(restoredWorkspace.isChallengeManuallyBlocked(901)).toBe(true)
    expect(
      restoredWorkspace.listSolverProgressStates().find((state) => state.challengeId === 901)
        ?.status,
    ).toBe("blocked")

    expect(restoredWorkspace.unblockChallengeSolver(901)).toBe(true)
    expect(restoredWorkspace.isChallengeManuallyBlocked(901)).toBe(false)
    await restoredWorkspace.shutdown()
  })

  test("restores solved challenge in managed list after workspace reopen", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const runtimeOptions = {
      plugin: new PersistenceMockPlugin(),
      pluginConfig: {
        baseUrl: "https://example.com",
        contest: { mode: "auto" as const },
        auth: { mode: "manual" as const },
        maxConcurrentContainers: 1,
      },
      startPaused: true,
    }

    const firstWorkspace = await createCTFRuntimeWorkspace({ rootDir, runtime: runtimeOptions })
    await firstWorkspace.setModelPoolItems([resolveDefaultPoolItem(1)])

    expect(firstWorkspace.markChallengeSolved(901)).toBe(true)
    expect(
      firstWorkspace.listSolverProgressStates().find((state) => state.challengeId === 901)?.status,
    ).toBe("solved")
    await firstWorkspace.shutdown()

    const restoredWorkspace = await createCTFRuntimeWorkspace({
      rootDir,
      runtime: {
        ...runtimeOptions,
        plugin: new PersistenceMockPlugin(),
      },
    })
    await restoredWorkspace.setModelPoolItems([resolveDefaultPoolItem(1)])

    expect(restoredWorkspace.getManagedChallengeIds()).toContain(901)
    expect(
      restoredWorkspace.listSolverProgressStates().find((state) => state.challengeId === 901)
        ?.status,
    ).toBe("solved")
    await restoredWorkspace.shutdown()
  })

  test("keeps solved challenge visible when platform listing no longer returns it", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const runtimeOptions = {
      plugin: new PersistenceMockPlugin(),
      pluginConfig: {
        baseUrl: "https://example.com",
        contest: { mode: "auto" as const },
        auth: { mode: "manual" as const },
        maxConcurrentContainers: 1,
      },
      startPaused: true,
    }

    const firstWorkspace = await createCTFRuntimeWorkspace({ rootDir, runtime: runtimeOptions })
    await firstWorkspace.setModelPoolItems([resolveDefaultPoolItem(1)])

    expect(firstWorkspace.markChallengeSolved(901)).toBe(true)
    await firstWorkspace.shutdown()

    const restoredWorkspace = await createCTFRuntimeWorkspace({
      rootDir,
      runtime: {
        ...runtimeOptions,
        plugin: new PersistenceMockPlugin(false),
      },
    })
    await restoredWorkspace.setModelPoolItems([resolveDefaultPoolItem(1)])

    expect(restoredWorkspace.getManagedChallengeIds()).toContain(901)
    expect(
      restoredWorkspace.listSolverProgressStates().find((state) => state.challengeId === 901)
        ?.status,
    ).toBe("solved")
    await restoredWorkspace.shutdown()
  })

  test("loads platform config and resolves env placeholders", async () => {
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
              maxConcurrentContainers: 1,
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
      await workspace.shutdown()
    }
  })
})
