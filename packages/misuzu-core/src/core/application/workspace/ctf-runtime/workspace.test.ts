import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vite-plus/test"
import { getModels } from "@mariozechner/pi-ai"
import { createCTFRuntimeWorkspace, createCTFRuntimeWorkspaceWithoutPersistence } from "../index.ts"
import type {
  CTFPlatformPlugin,
  ChallengeDetail,
  ChallengeSummary,
  ContestUpdate,
  PluginConfig,
} from "../../../../../plugins/index.ts"

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

class MockPlatformPlugin implements CTFPlatformPlugin {
  readonly meta = {
    id: "mock-platform",
    name: "Mock Platform",
  }

  private updates: ContestUpdate[] = []
  private readonly detailById = new Map<number, ChallengeDetail>()
  private pollCursor = 0
  private readonly seenPollCursors: Array<string | undefined> = []
  private persistedState: Record<string, unknown> = {}
  private restoredState?: Record<string, unknown>

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

  setPersistedState(state: Record<string, unknown>) {
    this.persistedState = state
  }

  getRestoredState() {
    return this.restoredState
  }

  getSeenPollCursors() {
    return [...this.seenPollCursors]
  }

  async setup(_config: PluginConfig) {}

  async login() {
    return {
      mode: "cookie" as const,
      cookie: "sid=mock",
      refreshable: false,
    }
  }

  async refreshAuth(session: Awaited<ReturnType<MockPlatformPlugin["login"]>>) {
    return session
  }

  async ensureAuthenticated() {
    return {
      mode: "cookie" as const,
      cookie: "sid=mock",
      refreshable: false,
    }
  }

  getAuthSession() {
    return {
      mode: "cookie" as const,
      cookie: "sid=mock",
      refreshable: false,
    }
  }

  getPersistedState() {
    return this.persistedState
  }

  async restoreFromPersistedState(state: Record<string, unknown>) {
    this.restoredState = state
    this.persistedState = state
  }

  async listContests() {
    return [{ id: 1, title: "Mock Contest" }]
  }

  async bindContest() {
    return { id: 1, title: "Mock Contest" }
  }

  async listChallenges() {
    return [...this.challenges]
  }

  async getChallenge(challengeId: number) {
    const detail = this.detailById.get(challengeId)
    if (!detail) {
      throw new Error(`Missing challenge detail: ${String(challengeId)}`)
    }
    return detail
  }

  async submitFlagRaw() {
    return {
      submissionId: 1,
      status: "WrongAnswer",
      accepted: false,
    }
  }

  async pollUpdates(cursor?: string) {
    this.seenPollCursors.push(cursor)

    const updates = [...this.updates]
    this.updates = []

    const cursorValue = cursor ? Number(cursor) : this.pollCursor
    const baseCursor = Number.isFinite(cursorValue) ? cursorValue : this.pollCursor
    this.pollCursor = baseCursor + 1

    return {
      cursor: String(this.pollCursor),
      updates,
    }
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
    await workspace.initializeRuntime({
      plugin,
      pluginConfig: {
        baseUrl: "https://example.com",
        contest: { mode: "auto" },
        auth: { mode: "cookie", cookie: "sid=abc" },
      },
    })

    expect(workspace.getManagedChallengeIds()).toEqual([301])

    const derivedWorkspace = await workspace.deriveSolverWorkspace("solver-301")
    expect(derivedWorkspace.rootDir).toBe(join(rootDir, "solvers", "solver-301"))
    expect(derivedWorkspace.configRootDir).toBe(rootDir)
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

  test("requires plugin to exist when plugin id is provided", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const workspace = createCTFRuntimeWorkspaceWithoutPersistence({ rootDir })

    await expect(
      workspace.initializeRuntime({
        pluginId: "missing-plugin",
        pluginConfig: {
          baseUrl: "https://example.com",
          contest: { mode: "auto" },
          auth: { mode: "cookie", cookie: "sid=abc" },
        },
      }),
    ).rejects.toThrow("missing from catalog")
  })

  test("requires pluginId when runtime plugin is not provided", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const workspace = createCTFRuntimeWorkspaceWithoutPersistence({ rootDir })

    await expect(
      workspace.initializeRuntime({
        pluginConfig: {
          baseUrl: "https://example.com",
          contest: { mode: "auto" },
          auth: { mode: "cookie", cookie: "sid=abc" },
        },
      }),
    ).rejects.toThrow("Missing pluginId")
  })

  test("initializes platform, creates challenge solvers, syncs notices and new challenges", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const workspace = createCTFRuntimeWorkspaceWithoutPersistence({ rootDir })

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
        auth: { mode: "cookie", cookie: "sid=abc" },
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

  test("restores plugin state, notice cursor and queue sequence from runtime snapshot", async () => {
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
    firstPlugin.setPersistedState({ token: "persisted-token", phase: 1 })

    const runtime = {
      plugin: firstPlugin,
      pluginConfig: {
        baseUrl: "https://example.com",
        contest: { mode: "auto" as const },
        auth: { mode: "cookie" as const, cookie: "sid=abc" },
      },
      cron: {
        noticePollIntervalMs: 60_000,
        challengeSyncIntervalMs: 60_000,
      },
    }

    const firstWorkspace = await createCTFRuntimeWorkspace({ rootDir, runtime })
    const firstTask = await firstWorkspace.enqueueTask({ challenge: 151 })
    expect(firstTask.taskId).toBe("task-1")

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

    expect(restoredPlugin.getRestoredState()).toEqual({ token: "persisted-token", phase: 1 })

    await restoredWorkspace.syncNoticesOnce()
    expect(restoredPlugin.getSeenPollCursors()).toContain("1")

    const secondTask = await restoredWorkspace.enqueueTask({ challenge: 151 })
    expect(secondTask.taskId).toBe("task-2")

    await restoredWorkspace.shutdown()
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
          auth: { mode: "cookie", cookie: "sid=abc" },
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
})
