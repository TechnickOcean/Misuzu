import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vite-plus/test"
import { getModels } from "@mariozechner/pi-ai"
import {
  createCTFRuntimeWorkspace,
  createCTFRuntimeWorkspaceWithoutPersistence,
} from "../../workspace.ts"
import type {
  ChallengeDetail,
  ChallengeSummary,
  CTFPlatformPlugin,
  ContestUpdate,
  PluginConfig,
} from "../../../../../../../plugins/index.ts"

const tempDirs: string[] = []

interface MockChallengeSeed {
  id: number
  title: string
  category: string
  score: number
  solvedCount: number
  requiresContainer?: boolean
  containerEntry?: string
  containerCloseTime?: number | null
}

async function createRuntimeWorkspaceDir() {
  const dir = await mkdtemp(join(tmpdir(), "misuzu-ctf-runtime-"))
  tempDirs.push(dir)
  return dir
}

function createChallenge(seed: MockChallengeSeed): ChallengeSummary {
  return {
    id: seed.id,
    title: seed.title,
    category: seed.category,
    score: seed.score,
    solvedCount: seed.solvedCount,
  }
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

async function waitForCondition(condition: () => boolean, timeoutMs = 1500, intervalMs = 20) {
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
  private readonly detailsByChallengeId = new Map<number, ChallengeDetail>()
  private pollCursor = 0
  private challengeSyncCount = 0
  private noticeSyncCount = 0

  constructor(private challenges: ChallengeSummary[]) {}

  seedChallengeDetail(seed: MockChallengeSeed) {
    const hasContainer =
      typeof seed.containerEntry === "string" && seed.containerEntry.trim().length > 0
    this.detailsByChallengeId.set(seed.id, {
      id: seed.id,
      title: seed.title,
      category: seed.category,
      score: seed.score,
      content: `${seed.title} description`,
      hints: [],
      requiresContainer: Boolean(seed.requiresContainer),
      attempts: 0,
      attachments: [],
      ...(hasContainer
        ? {
            container: {
              entry: seed.containerEntry,
              closeTime: seed.containerCloseTime,
            },
          }
        : {}),
    })
  }

  addChallenge(seed: MockChallengeSeed) {
    this.challenges = [...this.challenges, createChallenge(seed)]
    this.seedChallengeDetail(seed)
  }

  pushUpdate(update: ContestUpdate) {
    this.updates.push(update)
  }

  getSyncCounters() {
    return {
      challengeSyncCount: this.challengeSyncCount,
      noticeSyncCount: this.noticeSyncCount,
    }
  }

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

    this.challengeSyncCount += 1

    return [...this.challenges]
  }

  async getChallenge(context: {
    session: { cookie?: string }
    contestId: number
    challengeId: number
  }) {
    if (context.session.cookie !== "sid=mock" || context.contestId !== 1) {
      throw new Error("invalid context")
    }

    const detail = this.detailsByChallengeId.get(context.challengeId)
    if (!detail) {
      throw new Error(`Missing challenge detail: ${String(context.challengeId)}`)
    }

    return detail
  }

  async submitFlagRaw(context: {
    session: { cookie?: string }
    contestId: number
    challengeId: number
    flag: string
  }) {
    if (context.session.cookie !== "sid=mock" || context.contestId !== 1) {
      throw new Error("invalid context")
    }

    return {
      submissionId: 1,
      status: context.flag,
      accepted: context.flag.includes("accepted"),
    }
  }

  async pollUpdates(context: { session: { cookie?: string }; contestId: number; cursor?: string }) {
    if (context.session.cookie !== "sid=mock" || context.contestId !== 1) {
      throw new Error("invalid context")
    }

    this.noticeSyncCount += 1

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

function createPlugin(seeds: MockChallengeSeed[]) {
  const plugin = new MockPlatformPlugin(seeds.map((seed) => createChallenge(seed)))
  for (const seed of seeds) {
    plugin.seedChallengeDetail(seed)
  }

  return plugin
}

interface HoldableSolver {
  prompt: (prompt: string) => Promise<unknown>
  continue: () => Promise<unknown>
  abort: () => void
}

function holdSolverExecution(solver: HoldableSolver) {
  const rejectors: Array<(reason?: unknown) => void> = []
  let abortCallCount = 0

  const hold = async (_prompt?: string) =>
    new Promise<void>((_resolve, reject) => {
      rejectors.push(reject)
    })

  solver.prompt = hold
  solver.continue = hold
  solver.abort = () => {
    abortCallCount += 1
    for (const reject of rejectors.splice(0, rejectors.length)) {
      reject(new Error("solver aborted"))
    }
  }

  return {
    getAbortCallCount() {
      return abortCallCount
    },
  }
}

describe("ctf runtime platform integration", () => {
  test("lists built-in plugins for create workspace flow", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const workspace = createCTFRuntimeWorkspaceWithoutPersistence({ rootDir })

    expect(workspace.listAvailablePlugins().some((entry) => entry.id === "gzctf")).toBe(true)
    await workspace.shutdown()
  })

  test("initializes runtime and exposes managed challenge ids", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const workspace = createCTFRuntimeWorkspaceWithoutPersistence({ rootDir })
    const plugin = createPlugin([
      { id: 101, title: "web-checkin", category: "web", score: 100, solvedCount: 5 },
      { id: 102, title: "pwn-baby", category: "pwn", score: 200, solvedCount: 1 },
    ])

    await workspace.initializeRuntime({
      plugin,
      pluginConfig: {
        baseUrl: "https://example.com",
        contest: { mode: "auto" },
        auth: { mode: "manual" },
        maxConcurrentContainers: 1,
      },
      startPaused: true,
    })

    expect(workspace.getManagedChallengeIds().sort((a, b) => a - b)).toEqual([101, 102])
    expect(
      workspace
        .listManagedChallenges()
        .map((entry) => entry.title)
        .sort(),
    ).toEqual(["pwn-baby", "web-checkin"])

    await workspace.shutdown()
  })

  test("syncs new challenges when user triggers sync action", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const workspace = createCTFRuntimeWorkspaceWithoutPersistence({ rootDir })
    const plugin = createPlugin([
      { id: 201, title: "initial", category: "misc", score: 100, solvedCount: 0 },
    ])

    await workspace.initializeRuntime({
      plugin,
      pluginConfig: {
        baseUrl: "https://example.com",
        contest: { mode: "auto" },
        auth: { mode: "manual" },
        maxConcurrentContainers: 1,
      },
    })

    plugin.addChallenge({
      id: 202,
      title: "late-arrival",
      category: "crypto",
      score: 150,
      solvedCount: 0,
    })
    await workspace.syncChallengesOnce()

    expect(workspace.getManagedChallengeIds().sort((a, b) => a - b)).toEqual([201, 202])
    await workspace.shutdown()
  })

  test("sync notices steers only matching challenge solver", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const workspace = createCTFRuntimeWorkspaceWithoutPersistence({ rootDir })
    const plugin = createPlugin([
      { id: 301, title: "checkin", category: "misc", score: 100, solvedCount: 0 },
    ])

    await workspace.initializeRuntime({
      plugin,
      pluginConfig: {
        baseUrl: "https://example.com",
        contest: { mode: "auto" },
        auth: { mode: "manual" },
        maxConcurrentContainers: 1,
      },
    })

    const solver = workspace.getChallengeSolver(301)
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
      message: "checkin hint updated",
    })
    plugin.pushUpdate({
      id: 2,
      time: Date.now(),
      type: "Notice",
      message: "other challenge announcement",
    })

    await workspace.syncNoticesOnce()
    expect(steerCallCount).toBe(1)

    await workspace.shutdown()
  })

  test("keeps manual task pending while paused and runs after resume", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const workspace = createCTFRuntimeWorkspaceWithoutPersistence({ rootDir })
    const plugin = createPlugin([
      { id: 401, title: "pause-flow", category: "misc", score: 100, solvedCount: 0 },
    ])

    await workspace.initializeRuntime({
      plugin,
      pluginConfig: {
        baseUrl: "https://example.com",
        contest: { mode: "auto" },
        auth: { mode: "manual" },
        maxConcurrentContainers: 1,
      },
      startPaused: true,
    })
    await workspace.setModelPoolItems([resolveDefaultPoolItem()])

    const solver = workspace.getChallengeSolver(401)
    expect(solver).toBeDefined()

    let started = false
    solver!.prompt = async () => {
      started = true
    }

    const pendingTask = workspace.enqueueTask({ challenge: 401 }, "task-paused")
    await new Promise((resolve) => setTimeout(resolve, 40))

    expect(started).toBe(false)
    expect(workspace.listPendingSchedulerTasks().map((task) => task.taskId)).toContain(
      "task-paused",
    )

    workspace.resumeTaskDispatch()
    await pendingTask
    expect(started).toBe(true)

    await workspace.shutdown()
  })

  test("does not execute runtime cron jobs while dispatch is paused", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const workspace = createCTFRuntimeWorkspaceWithoutPersistence({ rootDir })
    const plugin = createPlugin([
      { id: 404, title: "pause-cron", category: "misc", score: 100, solvedCount: 0 },
    ])

    await workspace.initializeRuntime({
      plugin,
      pluginConfig: {
        baseUrl: "https://example.com",
        contest: { mode: "auto" },
        auth: { mode: "manual" },
        maxConcurrentContainers: 1,
      },
      startPaused: true,
      skipContextWarmup: true,
      skipInitialChallengeSync: true,
      cron: {
        noticePollIntervalMs: 25,
        challengeSyncIntervalMs: 25,
      },
    })

    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(plugin.getSyncCounters()).toEqual({
      challengeSyncCount: 0,
      noticeSyncCount: 0,
    })

    workspace.resumeTaskDispatch()
    await waitForCondition(() => {
      const counters = plugin.getSyncCounters()
      return counters.challengeSyncCount > 0 && counters.noticeSyncCount > 0
    })

    await workspace.shutdown()
  })

  test("allows cancelling pending manual task before execution", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const workspace = createCTFRuntimeWorkspaceWithoutPersistence({ rootDir })
    const plugin = createPlugin([
      { id: 402, title: "cancel-pending", category: "misc", score: 100, solvedCount: 0 },
    ])

    await workspace.initializeRuntime({
      plugin,
      pluginConfig: {
        baseUrl: "https://example.com",
        contest: { mode: "auto" },
        auth: { mode: "manual" },
        maxConcurrentContainers: 1,
      },
      startPaused: true,
    })

    await workspace.setModelPoolItems([resolveDefaultPoolItem()])
    const taskPromise = workspace.enqueueTask({ challenge: 402 }, "task-cancel-pending")

    expect(workspace.cancelSchedulerTask("task-cancel-pending")).toBe("pending")
    await expect(taskPromise).rejects.toThrow("Task cancelled")
    expect(workspace.listPendingSchedulerTasks().map((task) => task.taskId)).not.toContain(
      "task-cancel-pending",
    )

    await workspace.shutdown()
  })

  test("aborts inflight task when user cancels running solver", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const workspace = createCTFRuntimeWorkspaceWithoutPersistence({ rootDir })
    const plugin = createPlugin([
      { id: 403, title: "cancel-inflight", category: "misc", score: 100, solvedCount: 0 },
    ])

    await workspace.initializeRuntime({
      plugin,
      pluginConfig: {
        baseUrl: "https://example.com",
        contest: { mode: "auto" },
        auth: { mode: "manual" },
        maxConcurrentContainers: 1,
      },
    })
    await workspace.setModelPoolItems([resolveDefaultPoolItem()])

    const solver = workspace.getChallengeSolver(403)
    expect(solver).toBeDefined()

    const execution = holdSolverExecution(solver!)
    const runningTask = workspace.enqueueTask({ challenge: 403 }, "task-cancel-inflight")

    await waitForCondition(() => workspace.getSolverActivationState(403)?.status === "active")
    expect(workspace.cancelSchedulerTask("task-cancel-inflight")).toBe("inflight")
    await expect(runningTask).rejects.toThrow("solver aborted")
    expect(execution.getAbortCallCount()).toBe(1)

    await workspace.shutdown()
  })

  test("keeps task pending when model pool is empty and resumes after pool update", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const workspace = createCTFRuntimeWorkspaceWithoutPersistence({ rootDir })
    const plugin = createPlugin([
      { id: 501, title: "pool-late", category: "misc", score: 100, solvedCount: 0 },
    ])

    await workspace.initializeRuntime({
      plugin,
      pluginConfig: {
        baseUrl: "https://example.com",
        contest: { mode: "auto" },
        auth: { mode: "manual" },
        maxConcurrentContainers: 1,
      },
    })

    const solver = workspace.getChallengeSolver(501)
    expect(solver).toBeDefined()
    solver!.prompt = async () => {}
    solver!.continue = async () => {}

    const pendingTask = workspace.enqueueTask({ challenge: 501 }, "task-no-pool")
    await new Promise((resolve) => setTimeout(resolve, 40))

    expect(workspace.getSolverActivationState(501)?.status).toBe("model_unassigned")
    expect(workspace.listPendingSchedulerTasks().map((task) => task.taskId)).toContain(
      "task-no-pool",
    )

    await workspace.setModelPoolItems([resolveDefaultPoolItem()])
    await expect(pendingTask).resolves.toMatchObject({ taskId: "task-no-pool" })

    await workspace.shutdown()
  })

  test("auto orchestration respects model slots and max concurrent containers", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const workspace = createCTFRuntimeWorkspaceWithoutPersistence({ rootDir })
    const plugin = createPlugin([
      {
        id: 601,
        title: "web-container",
        category: "web",
        score: 100,
        solvedCount: 0,
        requiresContainer: true,
      },
      {
        id: 602,
        title: "pwn-container",
        category: "pwn",
        score: 100,
        solvedCount: 0,
        requiresContainer: true,
      },
      {
        id: 603,
        title: "crypto-no-container",
        category: "crypto",
        score: 100,
        solvedCount: 0,
        requiresContainer: false,
      },
      {
        id: 604,
        title: "misc-no-container",
        category: "misc",
        score: 100,
        solvedCount: 0,
        requiresContainer: false,
      },
    ])

    await workspace.initializeRuntime({
      plugin,
      pluginConfig: {
        baseUrl: "https://example.com",
        contest: { mode: "auto" },
        auth: { mode: "manual" },
        maxConcurrentContainers: 1,
      },
      startPaused: true,
    })
    await workspace.setModelPoolItems([resolveDefaultPoolItem(3)])

    for (const challengeId of [601, 602, 603, 604]) {
      const solver = workspace.getChallengeSolver(challengeId)
      expect(solver).toBeDefined()
      holdSolverExecution(solver!)
    }

    workspace.setAutoDispatchManaged(true)
    workspace.resumeTaskDispatch()

    await waitForCondition(() => workspace.getSchedulerState().busySolverCount >= 3)

    const managedById = new Map(
      workspace
        .listManagedChallenges()
        .map((challenge) => [challenge.challengeId, challenge] as const),
    )
    const activeChallengeIds = workspace
      .listSolverActivationStates()
      .filter((state) => state.status === "active")
      .map((state) => state.challengeId)

    const activeContainerCount = activeChallengeIds.filter((challengeId) => {
      const challenge = managedById.get(challengeId)
      return challenge?.requiresContainer !== false
    }).length

    expect(activeChallengeIds.length).toBe(3)
    expect(activeContainerCount).toBe(1)

    workspace.pauseTaskDispatch()
    await workspace.shutdown()
  })

  test("reserves container slots for pre-existing remote containers", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const workspace = createCTFRuntimeWorkspaceWithoutPersistence({ rootDir })
    const plugin = createPlugin([
      {
        id: 651,
        title: "pwn-remote-container",
        category: "pwn",
        score: 100,
        solvedCount: 0,
        requiresContainer: true,
        containerEntry: "remote-651",
        containerCloseTime: Date.now() + 10 * 60_000,
      },
      {
        id: 652,
        title: "web-needs-new-container",
        category: "web",
        score: 100,
        solvedCount: 0,
        requiresContainer: true,
      },
      {
        id: 653,
        title: "misc-no-container",
        category: "misc",
        score: 100,
        solvedCount: 0,
        requiresContainer: false,
      },
    ])

    await workspace.initializeRuntime({
      plugin,
      pluginConfig: {
        baseUrl: "https://example.com",
        contest: { mode: "auto" },
        auth: { mode: "manual" },
        maxConcurrentContainers: 1,
      },
      startPaused: true,
    })
    await workspace.setModelPoolItems([resolveDefaultPoolItem(2)])

    for (const challengeId of [651, 652, 653]) {
      const solver = workspace.getChallengeSolver(challengeId)
      expect(solver).toBeDefined()
      holdSolverExecution(solver!)
    }

    workspace.setAutoDispatchManaged(true)
    workspace.resumeTaskDispatch()

    await waitForCondition(() => workspace.getSchedulerState().busySolverCount >= 2)

    const activeChallengeIds = workspace
      .listSolverActivationStates()
      .filter((state) => state.status === "active")
      .map((state) => state.challengeId)

    expect(activeChallengeIds).toContain(651)
    expect(activeChallengeIds).toContain(653)
    expect(activeChallengeIds).not.toContain(652)

    workspace.pauseTaskDispatch()
    await workspace.shutdown()
  })

  test("ignores expired remote containers when computing available container slots", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const workspace = createCTFRuntimeWorkspaceWithoutPersistence({ rootDir })
    const plugin = createPlugin([
      {
        id: 661,
        title: "pwn-expired-container",
        category: "pwn",
        score: 100,
        solvedCount: 0,
        requiresContainer: true,
        containerEntry: "expired-661",
        containerCloseTime: Date.now() - 1_000,
      },
      {
        id: 662,
        title: "web-new-container",
        category: "web",
        score: 100,
        solvedCount: 0,
        requiresContainer: true,
      },
    ])

    await workspace.initializeRuntime({
      plugin,
      pluginConfig: {
        baseUrl: "https://example.com",
        contest: { mode: "auto" },
        auth: { mode: "manual" },
        maxConcurrentContainers: 1,
      },
      startPaused: true,
    })
    await workspace.setModelPoolItems([resolveDefaultPoolItem(1)])

    for (const challengeId of [661, 662]) {
      const solver = workspace.getChallengeSolver(challengeId)
      expect(solver).toBeDefined()
      holdSolverExecution(solver!)
    }

    workspace.setAutoDispatchManaged(true)
    workspace.resumeTaskDispatch()

    await waitForCondition(() => workspace.getSchedulerState().busySolverCount >= 1)

    const activeChallengeIds = workspace
      .listSolverActivationStates()
      .filter((state) => state.status === "active")
      .map((state) => state.challengeId)

    expect(activeChallengeIds).toContain(662)

    workspace.pauseTaskDispatch()
    await workspace.shutdown()
  })

  test("manually blocked solver is not dispatched until unblocked", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const workspace = createCTFRuntimeWorkspaceWithoutPersistence({ rootDir })
    const plugin = createPlugin([
      {
        id: 671,
        title: "blocked-challenge",
        category: "web",
        score: 100,
        solvedCount: 0,
        requiresContainer: false,
      },
      {
        id: 672,
        title: "active-challenge",
        category: "misc",
        score: 100,
        solvedCount: 0,
        requiresContainer: false,
      },
    ])

    await workspace.initializeRuntime({
      plugin,
      pluginConfig: {
        baseUrl: "https://example.com",
        contest: { mode: "auto" },
        auth: { mode: "manual" },
        maxConcurrentContainers: 1,
      },
      startPaused: true,
    })
    await workspace.setModelPoolItems([resolveDefaultPoolItem(1)])

    for (const challengeId of [671, 672]) {
      const solver = workspace.getChallengeSolver(challengeId)
      expect(solver).toBeDefined()
      holdSolverExecution(solver!)
    }

    expect(workspace.blockChallengeSolver(671)).toBe(true)
    expect(workspace.isChallengeManuallyBlocked(671)).toBe(true)

    expect(() => workspace.enqueueTask({ challenge: 671 }, "task-blocked-manual")).toThrow(
      /blocked/i,
    )

    workspace.setAutoDispatchManaged(true)
    workspace.resumeTaskDispatch()

    await waitForCondition(() => workspace.getSchedulerState().busySolverCount >= 1)

    const activeChallengeIds = workspace
      .listSolverActivationStates()
      .filter((state) => state.status === "active")
      .map((state) => state.challengeId)

    expect(activeChallengeIds).toContain(672)
    expect(activeChallengeIds).not.toContain(671)

    expect(workspace.unblockChallengeSolver(671)).toBe(true)
    expect(workspace.isChallengeManuallyBlocked(671)).toBe(false)

    workspace.pauseTaskDispatch()
    await workspace.shutdown()
  })

  test("auto-initializes runtime when workspace is created with runtime options", async () => {
    const rootDir = await createRuntimeWorkspaceDir()
    const plugin = createPlugin([
      { id: 701, title: "boot-runtime", category: "web", score: 120, solvedCount: 1 },
    ])

    const workspace = await createCTFRuntimeWorkspace({
      rootDir,
      runtime: {
        plugin,
        pluginConfig: {
          baseUrl: "https://example.com",
          contest: { mode: "auto" },
          auth: { mode: "manual" },
          maxConcurrentContainers: 1,
        },
      },
    })

    expect(workspace.getManagedChallengeIds()).toEqual([701])
    await workspace.shutdown()
  })
})
