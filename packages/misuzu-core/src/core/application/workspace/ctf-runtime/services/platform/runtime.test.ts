import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vite-plus/test"
import { getModels } from "@mariozechner/pi-ai"
import {
  createCTFRuntimeWorkspace,
  createCTFRuntimeWorkspaceWithoutPersistence,
} from "../../workspace.ts"
import { providerRegistryToken } from "../../../../../infrastructure/di/tokens.ts"
import { ProviderRegistry, type ProxyProviderOptions } from "../../../../providers/registry.ts"
import type {
  CTFPlatformPlugin,
  ChallengeDetail,
  ChallengeSummary,
  ContestUpdate,
  PluginConfig,
} from "../../../../../../../plugins/index.ts"

const tempDirs: string[] = []

async function createRuntimeWorkspaceDir() {
  const dir = await mkdtemp(join(tmpdir(), "misuzu-ctf-runtime-"))
  tempDirs.push(dir)
  return dir
}

function resolveDefaultPoolItem(maxConcurrency = 1) {
  const defaultModel = getModels("openai")[0]
  if (!defaultModel) {
    throw new Error("OpenAI default model is missing for test model pool setup")
  }

  return {
    provider: defaultModel.provider,
    modelId: defaultModel.id,
    maxConcurrency,
  }
}

async function waitForCondition(condition: () => boolean, timeoutMs = 1200, intervalMs = 20) {
  const startedAt = Date.now()
  while (!condition()) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error("Condition was not met within timeout")
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

class MockPlatformPlugin implements CTFPlatformPlugin {
  readonly meta = {
    id: "mock-platform",
    name: "Mock Platform",
  }

  private updates: ContestUpdate[] = []
  private readonly detailById = new Map<number, ChallengeDetail>()
  private pollCursor = 0
  private readonly seenPollCursors: Array<string | undefined> = []
  private loginCallCount = 0
  private readonly seenContestIds: number[] = []

  constructor(private challenges: ChallengeSummary[]) {
    for (const challenge of challenges) {
      this.detailById.set(challenge.id, {
        id: challenge.id,
        title: challenge.title,
        category: challenge.category,
        score: challenge.score,
        content: `${challenge.title} description`,
        hints: [],
        requiresContainer: false,
        attempts: 0,
        attachments: [],
      })
    }
  }

  addChallenge(challenge: ChallengeSummary) {
    this.challenges = [...this.challenges, challenge]
    this.detailById.set(challenge.id, {
      id: challenge.id,
      title: challenge.title,
      category: challenge.category,
      score: challenge.score,
      content: `${challenge.title} description`,
      hints: [],
      requiresContainer: false,
      attempts: 0,
      attachments: [],
    })
  }

  pushUpdate(update: ContestUpdate) {
    this.updates.push(update)
  }

  getSeenPollCursors() {
    return [...this.seenPollCursors]
  }

  getLoginCallCount() {
    return this.loginCallCount
  }

  getSeenContestIds() {
    return [...this.seenContestIds]
  }

  async setup(_config: PluginConfig) {}

  async login() {
    this.loginCallCount += 1
    return {
      mode: "manual" as const,
      cookie: "sid=mock",
      refreshable: false,
    }
  }

  async validateSession(session: Awaited<ReturnType<MockPlatformPlugin["login"]>>) {
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
    if (context.session.cookie !== "sid=mock") {
      throw new Error("invalid session")
    }

    this.seenContestIds.push(context.contestId)
    return [...this.challenges]
  }

  async getChallenge(context: {
    session: { cookie?: string }
    contestId: number
    challengeId: number
  }) {
    if (context.session.cookie !== "sid=mock") {
      throw new Error("invalid session")
    }

    this.seenContestIds.push(context.contestId)
    const { challengeId } = context
    const detail = this.detailById.get(challengeId)
    if (!detail) {
      throw new Error(`Missing challenge detail: ${String(challengeId)}`)
    }
    return detail
  }

  async submitFlagRaw(context: {
    session: { cookie?: string }
    contestId: number
    challengeId: number
    flag: string
  }) {
    if (context.session.cookie !== "sid=mock") {
      throw new Error("invalid session")
    }

    this.seenContestIds.push(context.contestId)

    return {
      submissionId: 1,
      status: `${context.challengeId}:${context.flag}`,
      accepted: context.flag.includes("accepted"),
    }
  }

  async pollUpdates(context: { session: { cookie?: string }; contestId: number; cursor?: string }) {
    if (context.session.cookie !== "sid=mock") {
      throw new Error("invalid session")
    }

    this.seenContestIds.push(context.contestId)
    this.seenPollCursors.push(context.cursor)

    const updates = [...this.updates]
    this.updates = []

    const cursorValue = context.cursor ? Number(context.cursor) : this.pollCursor
    const baseCursor = Number.isFinite(cursorValue) ? cursorValue : this.pollCursor
    this.pollCursor = baseCursor + 1

    return {
      cursor: String(this.pollCursor),
      updates,
    }
  }
}

class CountingProviderRegistry extends ProviderRegistry {
  registerProxyProvidersCalls = 0

  registerProxyProviders(optionsList: ProxyProviderOptions[]) {
    this.registerProxyProvidersCalls += 1
    return super.registerProxyProviders(optionsList)
  }
}

describe("ctf runtime platform integration", () => {
  test("lists built-in plugins from catalog", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const workspace = createCTFRuntimeWorkspaceWithoutPersistence({ rootDir })
    expect(workspace.listAvailablePlugins().some((entry) => entry.id === "gzctf")).toBe(true)
    await workspace.shutdown()
  })

  test("derives solver workspace under solvers and inherits parent config", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    await mkdir(join(rootDir, ".misuzu", "skills", "parent-skill"), { recursive: true })
    await writeFile(
      join(rootDir, ".misuzu", "skills", "parent-skill", "SKILL.md"),
      [
        "---",
        "name: parent-skill",
        "description: inherited skill from parent workspace",
        "---",
        "",
        "Parent skill body",
      ].join("\n"),
      "utf-8",
    )

    const sourceModel = getModels("openai")[0]
    await mkdir(join(rootDir, ".misuzu"), { recursive: true })
    await writeFile(
      join(rootDir, ".misuzu", "providers.json"),
      JSON.stringify(
        [
          {
            provider: "derived-parent-provider",
            baseProvider: "openai",
            modelMappings: [sourceModel!.id],
          },
        ],
        null,
        2,
      ),
      "utf-8",
    )

    const plugin = new MockPlatformPlugin([
      {
        id: 301,
        title: "derived-solver",
        category: "misc",
        score: 100,
        solvedCount: 0,
      },
    ])

    const workspace = createCTFRuntimeWorkspaceWithoutPersistence({ rootDir })
    await workspace.setModelPoolItems([resolveDefaultPoolItem()])
    await workspace.initializeRuntime({
      plugin,
      pluginConfig: {
        baseUrl: "https://example.com",
        contest: { mode: "auto" },
        auth: { mode: "manual" },
      },
    })

    expect(workspace.getManagedChallengeIds()).toEqual([301])

    const derivedWorkspace = await workspace.deriveSolverWorkspace("solver-301")
    expect(derivedWorkspace.rootDir).toBe(join(rootDir, "solvers", "solver-301"))
    expect(derivedWorkspace.configRootDir).toBe(rootDir)
    expect(derivedWorkspace.providers).toBe(workspace.providers)
    expect(derivedWorkspace.providerConfigPath).toBe(
      join(rootDir, "solvers", "solver-301", ".misuzu", "providers.json"),
    )
    expect(derivedWorkspace.getModel("derived-parent-provider", sourceModel!.id)).toBeDefined()

    const solver = workspace.getChallengeSolver(301)
    expect(solver).toBeDefined()
    expect(solver!.state.systemPrompt).toContain("parent-skill")

    await access(join(rootDir, "solvers", "solver-301", ".misuzu", "workspace-state.json"))

    await workspace.shutdown()
  })

  test("shares provider bootstrap across derived solver workspaces", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const sourceModel = getModels("openai")[0]

    await mkdir(join(rootDir, ".misuzu"), { recursive: true })
    await writeFile(
      join(rootDir, ".misuzu", "providers.json"),
      JSON.stringify(
        [
          {
            provider: "shared-provider",
            baseProvider: "openai",
            modelMappings: [sourceModel!.id],
          },
        ],
        null,
        2,
      ),
      "utf-8",
    )

    const countingProviders = new CountingProviderRegistry()
    const workspace = createCTFRuntimeWorkspaceWithoutPersistence({
      rootDir,
      configureContainer: (container) => {
        container.registerValue(providerRegistryToken, countingProviders)
      },
    })

    const plugin = new MockPlatformPlugin([
      {
        id: 401,
        title: "solver-a",
        category: "misc",
        score: 100,
        solvedCount: 0,
      },
      {
        id: 402,
        title: "solver-b",
        category: "web",
        score: 150,
        solvedCount: 0,
      },
    ])

    await workspace.initializeRuntime({
      plugin,
      pluginConfig: {
        baseUrl: "https://example.com",
        contest: { mode: "auto" },
        auth: { mode: "manual" },
      },
    })

    expect(workspace.getManagedChallengeIds().sort((a, b) => a - b)).toEqual([401, 402])
    expect(countingProviders.registerProxyProvidersCalls).toBe(1)

    await workspace.shutdown()
  })

  test("requires plugin to exist when plugin id is provided", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const workspace = createCTFRuntimeWorkspaceWithoutPersistence({ rootDir })

    await expect(
      workspace.initializeRuntime({
        pluginId: "missing-plugin",
        pluginConfig: {
          baseUrl: "https://example.com",
          contest: { mode: "auto" },
          auth: { mode: "manual" },
        },
      }),
    ).rejects.toThrow("missing from catalog")
  })

  test("auto-loads runtime config from platformConfigPath during workspace creation", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    await mkdir(join(rootDir, ".misuzu"), { recursive: true })
    await writeFile(
      join(rootDir, ".misuzu", "platform.json"),
      JSON.stringify(
        {
          pluginId: "missing-plugin",
          pluginConfig: {
            baseUrl: "https://example.com",
            contest: { mode: "auto" },
            auth: { mode: "manual" },
          },
        },
        null,
        2,
      ),
      "utf-8",
    )

    await expect(createCTFRuntimeWorkspace({ rootDir })).rejects.toThrow("missing from catalog")
  })

  test("requires pluginId when runtime plugin is not provided", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const workspace = createCTFRuntimeWorkspaceWithoutPersistence({ rootDir })

    await expect(
      workspace.initializeRuntime({
        pluginConfig: {
          baseUrl: "https://example.com",
          contest: { mode: "auto" },
          auth: { mode: "manual" },
        },
      }),
    ).rejects.toThrow("Missing pluginId")
  })

  test("initializes platform, creates challenge solvers, syncs notices and new challenges", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const workspace = createCTFRuntimeWorkspaceWithoutPersistence({ rootDir })
    await workspace.setModelPoolItems([resolveDefaultPoolItem()])

    const plugin = new MockPlatformPlugin([
      {
        id: 101,
        title: "checkin",
        category: "misc",
        score: 100,
        solvedCount: 10,
      },
    ])

    await workspace.initializeRuntime({
      plugin,
      pluginConfig: {
        baseUrl: "https://example.com",
        contest: { mode: "auto" },
        auth: { mode: "manual" },
      },
      cron: {
        noticePollIntervalMs: 60_000,
        challengeSyncIntervalMs: 60_000,
      },
    })

    expect(workspace.getManagedChallengeIds()).toEqual([101])
    const solver = workspace.getChallengeSolver(101)
    expect(solver).toBeDefined()

    let steerCallCount = 0
    const originalSteer = solver!.steer.bind(solver)
    solver!.steer = (message: string) => {
      steerCallCount += 1
      originalSteer(message)
    }

    plugin.pushUpdate({
      id: 1,
      time: Date.now(),
      type: "Notice",
      message: "checkin hint updated, please refresh attachment",
    })

    await workspace.syncNoticesOnce()

    expect(steerCallCount).toBe(1)

    plugin.addChallenge({
      id: 102,
      title: "new-pwn",
      category: "pwn",
      score: 300,
      solvedCount: 0,
    })

    await workspace.syncChallengesOnce()

    expect(workspace.getManagedChallengeIds().sort((a, b) => a - b)).toEqual([101, 102])

    await workspace.shutdown()
  })

  test("reports solver activation state during execution", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const workspace = createCTFRuntimeWorkspaceWithoutPersistence({ rootDir })

    const plugin = new MockPlatformPlugin([
      {
        id: 111,
        title: "activation-state",
        category: "misc",
        score: 100,
        solvedCount: 1,
      },
    ])

    await workspace.initializeRuntime({
      plugin,
      pluginConfig: {
        baseUrl: "https://example.com",
        contest: { mode: "auto" },
        auth: { mode: "manual" },
      },
    })

    await workspace.setModelPoolItems([resolveDefaultPoolItem()])

    const solver = workspace.getChallengeSolver(111)
    expect(solver).toBeDefined()

    let finishPrompt: (() => void) | undefined
    const waitForFinish = async () => {
      await new Promise<void>((resolve) => {
        finishPrompt = resolve
      })
    }
    solver!.prompt = waitForFinish
    solver!.continue = waitForFinish

    const runningTask = workspace.enqueueTask({ challenge: 111 })
    const activeState = workspace.getSolverActivationState(111)
    expect(activeState?.status).toBe("active")
    expect(activeState?.activeTaskId).toBeDefined()

    await waitForCondition(() => Boolean(finishPrompt))
    finishPrompt?.()
    await runningTask

    const inactiveState = workspace.getSolverActivationState(111)
    expect(inactiveState?.status).toBe("inactive")

    await workspace.shutdown()
  })

  test("keeps queue paused when runtime initializes with startPaused", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const workspace = createCTFRuntimeWorkspaceWithoutPersistence({ rootDir })

    const plugin = new MockPlatformPlugin([
      {
        id: 121,
        title: "paused-runtime",
        category: "misc",
        score: 100,
        solvedCount: 0,
      },
    ])

    await workspace.initializeRuntime({
      plugin,
      pluginConfig: {
        baseUrl: "https://example.com",
        contest: { mode: "auto" },
        auth: { mode: "manual" },
      },
      startPaused: true,
    })

    await workspace.setModelPoolItems([resolveDefaultPoolItem()])
    const solver = workspace.getChallengeSolver(121)
    expect(solver).toBeDefined()

    let started = false
    let finishPrompt: (() => void) | undefined
    solver!.prompt = async () => {
      started = true
      await new Promise<void>((resolve) => {
        finishPrompt = resolve
      })
    }

    const pendingTask = workspace.enqueueTask({ challenge: 121 }, "task-paused-runtime")

    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(started).toBe(false)
    expect(workspace.isTaskDispatchPaused()).toBe(true)

    workspace.resumeTaskDispatch()

    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(started).toBe(true)

    finishPrompt?.()
    await pendingTask

    await workspace.shutdown()
  })

  test("aborts active solver loop when dispatch is paused", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const workspace = createCTFRuntimeWorkspaceWithoutPersistence({ rootDir })

    const plugin = new MockPlatformPlugin([
      {
        id: 122,
        title: "pause-abort",
        category: "misc",
        score: 100,
        solvedCount: 0,
      },
    ])

    await workspace.initializeRuntime({
      plugin,
      pluginConfig: {
        baseUrl: "https://example.com",
        contest: { mode: "auto" },
        auth: { mode: "manual" },
      },
    })

    await workspace.setModelPoolItems([resolveDefaultPoolItem()])

    const solver = workspace.getChallengeSolver(122)
    expect(solver).toBeDefined()

    let rejectPrompt: ((error?: unknown) => void) | undefined
    let abortCallCount = 0

    solver!.prompt = async () => {
      await new Promise<void>((_resolve, reject) => {
        rejectPrompt = reject
      })
    }
    solver!.abort = () => {
      abortCallCount += 1
      rejectPrompt?.(new Error("solver aborted by pause"))
    }

    const runningTask = workspace.enqueueTask({ challenge: 122 }, "task-pause-abort")

    await waitForCondition(() => workspace.getSolverActivationState(122)?.status === "active")

    workspace.pauseTaskDispatch()

    await expect(runningTask).rejects.toThrow("solver aborted by pause")
    await waitForCondition(() => workspace.getSolverActivationState(122)?.status === "inactive")
    expect(abortCallCount).toBe(1)
    expect(workspace.isTaskDispatchPaused()).toBe(true)

    await workspace.shutdown()
  })

  test("requires WriteUp.md before marking accepted challenge as solved", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const workspace = createCTFRuntimeWorkspaceWithoutPersistence({ rootDir })

    const plugin = new MockPlatformPlugin([
      {
        id: 123,
        title: "writeup-gate",
        category: "misc",
        score: 100,
        solvedCount: 0,
      },
    ])

    await workspace.initializeRuntime({
      plugin,
      pluginConfig: {
        baseUrl: "https://example.com",
        contest: { mode: "auto" },
        auth: { mode: "manual" },
      },
    })

    await workspace.setModelPoolItems([resolveDefaultPoolItem()])

    const solver = workspace.getChallengeSolver(123)
    expect(solver).toBeDefined()

    const solverHub = Reflect.get(workspace as object, "solverHub") as {
      submitFlag: (challengeId: number, flag: string) => Promise<{ accepted: boolean }>
    }
    const solverWorkspace = await workspace.deriveSolverWorkspace("solver-123")

    let promptCount = 0
    solver!.prompt = async () => {
      promptCount += 1
      await solverHub.submitFlag(123, "flag{accepted}")

      if (promptCount >= 2) {
        await writeFile(
          join(solverWorkspace.rootDir, "WriteUp.md"),
          "# Writeup\n\n- solved challenge\n",
          "utf-8",
        )
      }
    }

    await expect(workspace.enqueueTask({ challenge: 123 })).resolves.toMatchObject({
      solverId: "solver-123",
    })

    const progress = workspace.listSolverProgressStates().find((state) => state.challengeId === 123)
    expect(progress?.status).toBe("solved")
    expect(progress?.writeUpReady).toBe(true)

    await workspace.shutdown()
  })

  test("blocks accepted challenge completion when WriteUp.md is missing", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const workspace = createCTFRuntimeWorkspaceWithoutPersistence({ rootDir })

    const plugin = new MockPlatformPlugin([
      {
        id: 124,
        title: "writeup-missing",
        category: "misc",
        score: 100,
        solvedCount: 0,
      },
    ])

    await workspace.initializeRuntime({
      plugin,
      pluginConfig: {
        baseUrl: "https://example.com",
        contest: { mode: "auto" },
        auth: { mode: "manual" },
      },
    })

    await workspace.setModelPoolItems([resolveDefaultPoolItem()])

    const solver = workspace.getChallengeSolver(124)
    expect(solver).toBeDefined()

    const solverHub = Reflect.get(workspace as object, "solverHub") as {
      submitFlag: (challengeId: number, flag: string) => Promise<{ accepted: boolean }>
    }

    solver!.prompt = async () => {
      await solverHub.submitFlag(124, "flag{accepted}")
    }

    await expect(workspace.enqueueTask({ challenge: 124 })).rejects.toThrow(
      "WriteUp.md is still missing",
    )

    const progress = workspace.listSolverProgressStates().find((state) => state.challengeId === 124)
    expect(progress?.status).toBe("blocked")
    expect(progress?.writeUpReady).toBe(false)

    await workspace.shutdown()
  })

  test("keeps task pending with model-unassigned solver until pool is configured", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const workspace = createCTFRuntimeWorkspaceWithoutPersistence({ rootDir })

    const plugin = new MockPlatformPlugin([
      {
        id: 131,
        title: "no-pool-yet",
        category: "misc",
        score: 100,
        solvedCount: 0,
      },
    ])

    await workspace.initializeRuntime({
      plugin,
      pluginConfig: {
        baseUrl: "https://example.com",
        contest: { mode: "auto" },
        auth: { mode: "manual" },
      },
    })

    expect(workspace.getManagedChallengeIds()).toEqual([131])
    expect(workspace.getChallengeSolver(131)).toBeUndefined()
    expect(workspace.getSolverActivationState(131)?.status).toBe("model_unassigned")

    const pendingTask = workspace.enqueueTask({ challenge: 131 }, "task-no-model")
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(workspace.listPendingSchedulerTasks().map((task) => task.taskId)).toContain(
      "task-no-model",
    )
    expect(workspace.getSolverActivationState(131)?.status).toBe("model_unassigned")

    await workspace.setModelPoolItems([resolveDefaultPoolItem()])

    await expect(pendingTask).resolves.toMatchObject({
      solverId: "solver-131",
      taskId: "task-no-model",
    })
    expect(workspace.getChallengeSolver(131)).toBeDefined()
    expect(workspace.getSolverActivationState(131)?.status).toBe("inactive")

    await workspace.shutdown()
  })

  test("restores auth session, contest binding and queue sequence from runtime snapshot", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const firstPlugin = new MockPlatformPlugin([
      {
        id: 151,
        title: "persisted-runtime",
        category: "web",
        score: 150,
        solvedCount: 3,
      },
    ])
    const runtime = {
      plugin: firstPlugin,
      pluginConfig: {
        baseUrl: "https://example.com",
        contest: { mode: "auto" as const },
        auth: { mode: "manual" as const },
      },
      cron: {
        noticePollIntervalMs: 60_000,
        challengeSyncIntervalMs: 60_000,
      },
    }

    const firstWorkspace = await createCTFRuntimeWorkspace({ rootDir, runtime })
    await firstWorkspace.setModelPoolItems([resolveDefaultPoolItem()])
    const firstSolver = firstWorkspace.getChallengeSolver(151)
    expect(firstSolver).toBeDefined()
    firstSolver!.prompt = async () => {}

    const firstTask = await firstWorkspace.enqueueTask({ challenge: 151 })
    expect(firstTask.taskId).toBe("task-1")
    expect(firstPlugin.getLoginCallCount()).toBe(1)

    await firstWorkspace.syncNoticesOnce()
    await firstWorkspace.shutdown()

    const restoredPlugin = new MockPlatformPlugin([
      {
        id: 151,
        title: "persisted-runtime",
        category: "web",
        score: 150,
        solvedCount: 3,
      },
    ])

    const restoredWorkspace = await createCTFRuntimeWorkspace({
      rootDir,
      runtime: {
        ...runtime,
        plugin: restoredPlugin,
      },
    })

    await restoredWorkspace.setModelPoolItems([resolveDefaultPoolItem()])
    const restoredSolver = restoredWorkspace.getChallengeSolver(151)
    expect(restoredSolver).toBeDefined()
    restoredSolver!.prompt = async () => {}
    expect(restoredWorkspace.getSolverActivationState(151)?.status).toBe("inactive")

    expect(restoredPlugin.getLoginCallCount()).toBe(0)

    await restoredWorkspace.syncNoticesOnce()
    expect(restoredPlugin.getSeenPollCursors()).toContain("1")
    expect(restoredPlugin.getSeenContestIds()).toContain(1)

    const secondTask = await restoredWorkspace.enqueueTask({ challenge: 151 })
    expect(secondTask.taskId).toBe("task-2")

    await restoredWorkspace.shutdown()
  })

  test("restores solved progress and skips solver recreation for solved challenges", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const challengeId = 181

    const runtime = {
      plugin: new MockPlatformPlugin([
        {
          id: challengeId,
          title: "restore-solved",
          category: "misc",
          score: 120,
          solvedCount: 2,
        },
      ]),
      pluginConfig: {
        baseUrl: "https://example.com",
        contest: { mode: "auto" as const },
        auth: { mode: "manual" as const },
      },
    }

    const firstWorkspace = await createCTFRuntimeWorkspace({ rootDir, runtime })
    await firstWorkspace.setModelPoolItems([resolveDefaultPoolItem()])

    const solver = firstWorkspace.getChallengeSolver(challengeId)
    expect(solver).toBeDefined()

    const solverHub = Reflect.get(firstWorkspace as object, "solverHub") as {
      submitFlag: (targetChallengeId: number, flag: string) => Promise<{ accepted: boolean }>
    }

    const solverWorkspace = await firstWorkspace.deriveSolverWorkspace(
      `solver-${String(challengeId)}`,
    )

    solver!.prompt = async () => {
      await writeFile(
        join(solverWorkspace.rootDir, "WriteUp.md"),
        "# Writeup\n\n- restored solved challenge\n",
        "utf-8",
      )
      await solverHub.submitFlag(challengeId, "flag{accepted}")
    }

    await firstWorkspace.enqueueTask({ challenge: challengeId })

    const firstProgress = firstWorkspace
      .listSolverProgressStates()
      .find((state) => state.challengeId === challengeId)
    expect(firstProgress?.status).toBe("solved")

    await firstWorkspace.shutdown()

    const restoredWorkspace = await createCTFRuntimeWorkspace({
      rootDir,
      runtime: {
        ...runtime,
        plugin: new MockPlatformPlugin([
          {
            id: challengeId,
            title: "restore-solved",
            category: "misc",
            score: 120,
            solvedCount: 2,
          },
        ]),
      },
    })

    await restoredWorkspace.setModelPoolItems([resolveDefaultPoolItem()])

    const restoredProgress = restoredWorkspace
      .listSolverProgressStates()
      .find((state) => state.challengeId === challengeId)
    expect(restoredProgress?.status).toBe("solved")
    expect(restoredWorkspace.getChallengeSolver(challengeId)).toBeUndefined()

    await restoredWorkspace.shutdown()
  })

  test("uses continue loop for resumed solver with existing history", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const challengeId = 182
    const workspace = createCTFRuntimeWorkspaceWithoutPersistence({ rootDir })

    const plugin = new MockPlatformPlugin([
      {
        id: challengeId,
        title: "resume-continue",
        category: "misc",
        score: 90,
        solvedCount: 0,
      },
    ])

    await workspace.initializeRuntime({
      plugin,
      pluginConfig: {
        baseUrl: "https://example.com",
        contest: { mode: "auto" },
        auth: { mode: "manual" },
      },
    })

    await workspace.setModelPoolItems([resolveDefaultPoolItem()])

    const solver = workspace.getChallengeSolver(challengeId)
    expect(solver).toBeDefined()

    solver!.replaceMessages([
      {
        role: "assistant",
        content: [{ type: "text", text: "restored-history" }],
        timestamp: Date.now(),
      } as any,
    ])

    let promptCalls = 0
    let continueCalls = 0
    solver!.prompt = async () => {
      promptCalls += 1
    }
    solver!.continue = async () => {
      continueCalls += 1
    }

    await workspace.enqueueTask({ challenge: challengeId })

    expect(promptCalls).toBe(0)
    expect(continueCalls).toBe(1)

    await workspace.shutdown()
  })

  test("auto-recovers from unexpected solver stop by sending continue", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const challengeId = 183
    const workspace = createCTFRuntimeWorkspaceWithoutPersistence({ rootDir })

    const plugin = new MockPlatformPlugin([
      {
        id: challengeId,
        title: "unexpected-stop-recover",
        category: "misc",
        score: 80,
        solvedCount: 0,
      },
    ])

    await workspace.initializeRuntime({
      plugin,
      pluginConfig: {
        baseUrl: "https://example.com",
        contest: { mode: "auto" },
        auth: { mode: "manual" },
      },
    })

    await workspace.setModelPoolItems([resolveDefaultPoolItem()])

    const solver = workspace.getChallengeSolver(challengeId)
    expect(solver).toBeDefined()

    let promptCalls = 0
    let continueCalls = 0
    solver!.prompt = async () => {
      promptCalls += 1
      throw new Error("unexpected agent stop")
    }
    solver!.continue = async () => {
      continueCalls += 1
    }

    await expect(workspace.enqueueTask({ challenge: challengeId })).resolves.toMatchObject({
      solverId: `solver-${String(challengeId)}`,
    })
    expect(promptCalls).toBe(1)
    expect(continueCalls).toBe(1)

    await workspace.shutdown()
  })

  test("supports platform initialization during workspace creation", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const plugin = new MockPlatformPlugin([
      {
        id: 201,
        title: "auto-init",
        category: "web",
        score: 50,
        solvedCount: 1,
      },
    ])

    const workspace = await createCTFRuntimeWorkspace({
      rootDir,
      runtime: {
        plugin,
        pluginConfig: {
          baseUrl: "https://example.com",
          contest: { mode: "auto" },
          auth: { mode: "manual" },
        },
        cron: {
          noticePollIntervalMs: 60_000,
          challengeSyncIntervalMs: 60_000,
        },
      },
    })

    expect(workspace.getManagedChallengeIds()).toEqual([201])
    await workspace.shutdown()
  })

  test("restores environment agent state alongside runtime snapshot", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const firstPlugin = new MockPlatformPlugin([
      {
        id: 241,
        title: "runtime-with-environment-agent",
        category: "misc",
        score: 200,
        solvedCount: 2,
      },
    ])

    const runtime = {
      plugin: firstPlugin,
      pluginConfig: {
        baseUrl: "https://example.com",
        contest: { mode: "auto" as const },
        auth: { mode: "manual" as const },
      },
    }

    const firstWorkspace = await createCTFRuntimeWorkspace({ rootDir, runtime })
    await firstWorkspace.setModelPoolItems([resolveDefaultPoolItem()])
    const firstEnvironmentAgent = firstWorkspace.createEnvironmentAgent({
      initialState: {
        systemPrompt: "environment-agent-with-runtime",
        thinkingLevel: "low",
      },
    })

    firstEnvironmentAgent.appendMessage({
      role: "user",
      content: "persisted-environment-runtime-message",
      timestamp: Date.now(),
    })
    await firstWorkspace.persistRuntimeState()
    await firstWorkspace.shutdown()

    const restoredPlugin = new MockPlatformPlugin([
      {
        id: 241,
        title: "runtime-with-environment-agent",
        category: "misc",
        score: 200,
        solvedCount: 2,
      },
    ])

    const restoredWorkspace = await createCTFRuntimeWorkspace({
      rootDir,
      runtime: {
        ...runtime,
        plugin: restoredPlugin,
      },
    })

    await restoredWorkspace.setModelPoolItems([resolveDefaultPoolItem()])

    expect(restoredPlugin.getLoginCallCount()).toBe(0)

    const restoredEnvironmentAgent = restoredWorkspace.createEnvironmentAgent()
    expect(restoredEnvironmentAgent.state.systemPrompt).toContain("environment-agent-with-runtime")
    expect(restoredEnvironmentAgent.state.thinkingLevel).toBe("low")
    expect(JSON.stringify(restoredEnvironmentAgent.state.messages)).toContain(
      "persisted-environment-runtime-message",
    )

    await restoredWorkspace.shutdown()
  })
})
