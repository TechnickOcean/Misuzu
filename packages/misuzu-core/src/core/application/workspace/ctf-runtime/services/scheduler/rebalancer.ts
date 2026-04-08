import type { PersistedCTFRuntimeManagedChallenge } from "../../state.ts"
import type { DispatchTask, SolverTaskCancelResult, SolverTaskResult } from "./queue.ts"
import type { UnexpectedSolverStopEvent } from "../platform/hub.ts"
import {
  RANK_HARD_CAP_MS,
  RANK_HARD_COOLDOWN_MS,
  RANK_REBALANCE_INTERVAL_MS,
  RANK_STOP_BURST_LIMIT,
  RANK_STOP_COOLDOWN_MS,
  RANK_STOP_RECOVERY_WINDOW_MS,
  type ChallengeRankState,
  type RankedCandidate,
  computeChallengeBaseRank,
  computeChallengeRank,
} from "./rank.ts"
import type { PersistedCTFRuntimeSchedulerState } from "../../state.ts"

interface ChallengeProgressLike {
  challengeId: number
  status: "idle" | "writeup_required" | "solved" | "blocked"
}

interface RuntimeSchedulerStateLike {
  registeredSolverCount: number
}

interface ModelPoolStateLike {
  totalCapacity: number
  totalAvailable: number
}

interface DispatchLimitsLike {
  maxConcurrentContainers: number
}

export interface DispatchIntent {
  taskId: string
  challengeId: number
  source: "auto" | "manual"
  priority: number
  createdAt: number
  payload: unknown
  reason?: string
}

export interface RuntimeRankOrchestratorHost {
  listManagedChallenges(): PersistedCTFRuntimeManagedChallenge[]
  listSolverProgressStates(): ChallengeProgressLike[]
  getSchedulerState(): RuntimeSchedulerStateLike
  getModelPoolState(): ModelPoolStateLike
  getDispatchLimits(): DispatchLimitsLike
  listInflightDispatchTasks(): DispatchTask[]
  runDispatchTask(task: DispatchTask): Promise<SolverTaskResult>
  cancelInflightTask(taskId: string): SolverTaskCancelResult | undefined
  abortAllRunningTasks(): void
  setUnexpectedSolverStopListener(listener: (event: UnexpectedSolverStopEvent) => void): void
  notifyStateChanged(): void
}

export class RuntimeRankOrchestrator {
  private readonly rankByChallenge = new Map<number, ChallengeRankState>()
  private readonly pendingIntents = new Map<string, DispatchIntent>()
  private readonly expectedStopTaskIds = new Set<string>()
  private taskCounter = 0
  private dispatchAutoManaged = false
  private dispatchPaused = false
  private rankRebalanceRunning = false
  private rankRebalanceRequested = false
  private rankRebalanceTimer?: NodeJS.Timeout
  private readonly pendingResolvers = new Map<
    string,
    {
      resolve: (result: SolverTaskResult) => void
      reject: (error: unknown) => void
    }
  >()

  constructor(private readonly host: RuntimeRankOrchestratorHost) {}

  initialize() {
    this.host.setUnexpectedSolverStopListener((event) => {
      this.handleUnexpectedSolverStop(event)
    })
    this.syncRankStates()
    this.ensureRankRebalanceTimer()
  }

  dispose() {
    if (!this.rankRebalanceTimer) {
      return
    }

    clearInterval(this.rankRebalanceTimer)
    this.rankRebalanceTimer = undefined
  }

  setDispatchAutoManaged(enabled: boolean) {
    this.dispatchAutoManaged = enabled
    this.scheduleRebalance(true)
  }

  isDispatchAutoManaged() {
    return this.dispatchAutoManaged
  }

  setDispatchPaused(paused: boolean) {
    this.dispatchPaused = paused
    if (paused) {
      this.expectedStopTaskIds.clear()
      for (const task of this.host.listInflightDispatchTasks()) {
        this.expectedStopTaskIds.add(task.taskId)
      }
      this.host.abortAllRunningTasks()
      this.host.notifyStateChanged()
      return
    }

    this.scheduleRebalance(true)
  }

  isDispatchPaused() {
    return this.dispatchPaused
  }

  onManagedChallengesChanged() {
    this.syncRankStates()
    this.scheduleRebalance(true)
  }

  scheduleRebalance(immediate = false) {
    if (this.rankRebalanceRunning) {
      this.rankRebalanceRequested = true
      return
    }

    const run = async () => {
      this.rankRebalanceRunning = true
      try {
        await this.reconcileDispatch()
      } finally {
        this.rankRebalanceRunning = false
        if (this.rankRebalanceRequested) {
          this.rankRebalanceRequested = false
          this.scheduleRebalance(true)
        }
      }
    }

    if (immediate) {
      void run()
      return
    }

    void run()
  }

  createManualIntent(payload: unknown, taskId?: string) {
    const challengeId = resolveChallengeIdFromPayload(payload)
    if (challengeId === undefined) {
      throw new Error("Manual dispatch requires payload.challenge as finite number")
    }

    const progress = this.host
      .listSolverProgressStates()
      .find((state) => state.challengeId === challengeId)
    if (progress?.status === "blocked") {
      throw new Error(`Challenge #${String(challengeId)} is blocked and cannot be queued`)
    }

    const nextTaskId = taskId ?? `task-${String(++this.taskCounter)}`
    this.pendingIntents.set(nextTaskId, {
      taskId: nextTaskId,
      challengeId,
      source: "manual",
      priority: 1_000_000,
      createdAt: Date.now(),
      payload,
    })
    this.host.notifyStateChanged()
    this.scheduleRebalance(true)
    return nextTaskId
  }

  enqueueTask(payload: unknown, taskId?: string) {
    const actualTaskId = this.createManualIntent(payload, taskId)
    return new Promise<SolverTaskResult>((resolve, reject) => {
      this.pendingResolvers.set(actualTaskId, { resolve, reject })
    })
  }

  cancelTask(taskId: string): SolverTaskCancelResult | undefined {
    if (this.pendingIntents.delete(taskId)) {
      this.pendingResolvers.get(taskId)?.reject(new Error(`Task cancelled: ${taskId}`))
      this.pendingResolvers.delete(taskId)
      this.host.notifyStateChanged()
      return "pending"
    }

    const cancelled = this.host.cancelInflightTask(taskId)
    if (cancelled === "inflight") {
      this.expectedStopTaskIds.add(taskId)
    }
    return cancelled
  }

  listPendingIntentsSnapshot() {
    return [...this.pendingIntents.values()].sort(
      (left, right) => right.priority - left.priority || left.createdAt - right.createdAt,
    )
  }

  snapshotState(): PersistedCTFRuntimeSchedulerState {
    return {
      taskCounter: this.taskCounter,
      autoManaged: this.dispatchAutoManaged,
      paused: this.dispatchPaused,
      pendingIntents: this.listPendingIntentsSnapshot().map((intent) => ({
        taskId: intent.taskId,
        challengeId: intent.challengeId,
        source: intent.source,
        priority: intent.priority,
        createdAt: intent.createdAt,
        payload: intent.payload,
        reason: intent.reason,
      })),
    }
  }

  listRankedCandidatesSnapshot() {
    this.syncRankStates()
    return this.computeRankedCandidates(Date.now())
  }

  restorePendingIntents(intents: DispatchIntent[]) {
    this.pendingIntents.clear()
    for (const intent of intents) {
      if (!intent.taskId || !Number.isFinite(intent.challengeId)) {
        continue
      }

      this.pendingIntents.set(intent.taskId, {
        taskId: intent.taskId,
        challengeId: intent.challengeId,
        source: intent.source === "manual" ? "manual" : "auto",
        priority: Number.isFinite(intent.priority) ? intent.priority : 0,
        createdAt: Number.isFinite(intent.createdAt) ? intent.createdAt : Date.now(),
        payload: intent.payload,
        reason: intent.reason,
      })
    }
  }

  restoreState(state: PersistedCTFRuntimeSchedulerState | undefined) {
    if (!state) {
      return
    }

    this.taskCounter = Number.isFinite(state.taskCounter) ? Math.max(0, state.taskCounter) : 0
    this.dispatchAutoManaged = Boolean(state.autoManaged)
    this.dispatchPaused = Boolean(state.paused)
    this.restorePendingIntents(state.pendingIntents)
  }

  private ensureRankRebalanceTimer() {
    if (this.rankRebalanceTimer) {
      return
    }

    this.rankRebalanceTimer = setInterval(() => {
      this.scheduleRebalance()
    }, RANK_REBALANCE_INTERVAL_MS)
    this.rankRebalanceTimer.unref?.()
  }

  private async reconcileDispatch() {
    if (this.dispatchPaused) {
      return
    }

    this.syncRankStates()
    const now = Date.now()
    const managedChallenges = this.host.listManagedChallenges()
    const progressByChallengeId = new Map(
      this.host.listSolverProgressStates().map((state) => [state.challengeId, state] as const),
    )
    const managedByChallengeId = new Map(
      managedChallenges.map((challenge) => [challenge.challengeId, challenge] as const),
    )
    const requiresContainerByChallengeId = new Map(
      managedChallenges.map((challenge) => [
        challenge.challengeId,
        challenge.requiresContainer !== false,
      ]),
    )
    const containerActiveByChallengeId = new Map(
      managedChallenges.map((challenge) => [
        challenge.challengeId,
        challenge.containerActive === true,
      ]),
    )

    if (this.dispatchAutoManaged) {
      const rankedCandidates = this.computeRankedCandidates(now)
      this.ensureAutoIntents(now, rankedCandidates)
      this.refreshAutoIntentPriorities(rankedCandidates)
    }

    for (const [taskId, intent] of this.pendingIntents) {
      if (intent.source !== "auto") {
        continue
      }

      if (!this.isAutoQueueEligible(intent.challengeId)) {
        this.pendingIntents.delete(taskId)
      }
    }

    const inflightTasks = this.host.listInflightDispatchTasks()
    const inflightByChallengeId = new Set(inflightTasks.map((task) => task.challengeId))
    const inflightTaskIds = new Set(inflightTasks.map((task) => task.taskId))
    const availableSlots = this.resolveAvailableDispatchSlots({
      candidateCount: this.rankByChallenge.size,
      inflightCount: inflightTasks.length,
    })
    const containerLimit = this.resolveContainerLimit()
    const reservedContainerChallenges = new Set(
      managedChallenges
        .filter((challenge) => challenge.containerActive === true)
        .map((challenge) => challenge.challengeId),
    )
    const inflightContainerCount = this.countInflightContainerTasks(
      inflightTasks,
      requiresContainerByChallengeId,
      containerActiveByChallengeId,
    )
    let availableContainerSlots = Number.isFinite(containerLimit)
      ? Math.max(0, containerLimit - reservedContainerChallenges.size - inflightContainerCount)
      : Number.POSITIVE_INFINITY

    this.trimAutoContainerIntents(
      requiresContainerByChallengeId,
      containerActiveByChallengeId,
      availableContainerSlots,
    )

    this.preemptLongRunningTasks(now, inflightTasks)

    if (availableSlots <= 0) {
      return
    }

    let started = 0
    for (const intent of this.listPendingIntentsSnapshot()) {
      if (started >= availableSlots) {
        break
      }

      if (inflightByChallengeId.has(intent.challengeId) || inflightTaskIds.has(intent.taskId)) {
        continue
      }

      const progress = progressByChallengeId.get(intent.challengeId)
      if (progress?.status === "blocked") {
        this.pendingIntents.delete(intent.taskId)
        this.pendingResolvers
          .get(intent.taskId)
          ?.reject(new Error(`Challenge #${String(intent.challengeId)} is blocked`))
        this.pendingResolvers.delete(intent.taskId)
        continue
      }

      const managed = managedByChallengeId.get(intent.challengeId)
      if (!managed) {
        continue
      }

      const requiresContainer = requiresContainerByChallengeId.get(intent.challengeId) ?? true
      const hasActiveContainer = containerActiveByChallengeId.get(intent.challengeId) ?? false
      if (requiresContainer && !hasActiveContainer && availableContainerSlots <= 0) {
        continue
      }

      this.pendingIntents.delete(intent.taskId)
      this.startDispatchTask({
        taskId: intent.taskId,
        challengeId: intent.challengeId,
        targetSolverId: managed.solverId,
        payload: intent.payload,
        source: intent.source,
        priority: intent.priority,
        createdAt: intent.createdAt,
        reason: intent.reason,
      })
      if (requiresContainer && !hasActiveContainer && Number.isFinite(availableContainerSlots)) {
        availableContainerSlots -= 1
      }
      started += 1
    }
  }

  private startDispatchTask(task: DispatchTask) {
    void this.host
      .runDispatchTask(task)
      .then((result) => {
        const rankState = this.rankByChallenge.get(task.challengeId)
        if (rankState) {
          rankState.queuedSince = undefined
          rankState.activeSince = undefined
          rankState.waitingSince = Date.now()
        }

        this.expectedStopTaskIds.delete(task.taskId)
        this.pendingResolvers.get(task.taskId)?.resolve(result)
        this.pendingResolvers.delete(task.taskId)
        this.host.notifyStateChanged()
        this.scheduleRebalance(true)
      })
      .catch((error) => {
        this.expectedStopTaskIds.delete(task.taskId)
        const resolver = this.pendingResolvers.get(task.taskId)
        const shouldRetryPausedTask = this.dispatchPaused && Boolean(resolver)
        const shouldRequeue =
          shouldRetryPausedTask || (!resolver && this.isAutoQueueEligible(task.challengeId))
        if (shouldRequeue) {
          this.pendingIntents.set(task.taskId, {
            taskId: task.taskId,
            challengeId: task.challengeId,
            source: task.source,
            priority: task.priority,
            createdAt: Date.now(),
            payload: task.payload,
            reason: task.reason,
          })
        }

        if (!shouldRetryPausedTask) {
          resolver?.reject(error)
          this.pendingResolvers.delete(task.taskId)
        }

        this.host.notifyStateChanged()
        this.scheduleRebalance(true)
      })
  }

  private ensureAutoIntents(now: number, ranked: RankedCandidate[]) {
    const queuedChallengeIds = new Set(
      this.listPendingIntentsSnapshot().map((intent) => intent.challengeId),
    )
    for (const candidate of ranked) {
      if (queuedChallengeIds.has(candidate.challengeId)) {
        continue
      }

      const taskId = `auto-${String(candidate.challengeId)}-${String(++this.taskCounter)}`
      this.pendingIntents.set(taskId, {
        taskId,
        challengeId: candidate.challengeId,
        source: "auto",
        priority: Math.round(candidate.rank * 100),
        createdAt: now,
        payload: { challenge: candidate.challengeId },
      })
      queuedChallengeIds.add(candidate.challengeId)
    }
  }

  private refreshAutoIntentPriorities(rankedCandidates: RankedCandidate[]) {
    const rankByChallengeId = new Map(
      rankedCandidates.map((candidate) => [candidate.challengeId, candidate.rank] as const),
    )

    for (const [taskId, intent] of this.pendingIntents) {
      if (intent.source !== "auto") {
        continue
      }

      const rank = rankByChallengeId.get(intent.challengeId)
      if (rank === undefined) {
        this.pendingIntents.delete(taskId)
        continue
      }

      intent.priority = Math.round(rank * 100)
    }
  }

  private preemptLongRunningTasks(now: number, inflightTasks: DispatchTask[]) {
    for (const task of inflightTasks) {
      const rankState = this.rankByChallenge.get(task.challengeId)
      const activeDurationMs = rankState?.activeSince ? now - rankState.activeSince : 0
      if (activeDurationMs < RANK_HARD_CAP_MS) {
        continue
      }

      if (rankState) {
        rankState.cooldownUntil = now + RANK_HARD_COOLDOWN_MS
      }

      this.expectedStopTaskIds.add(task.taskId)
      this.host.cancelInflightTask(task.taskId)
    }
  }

  private syncRankStates() {
    const now = Date.now()
    const managedChallenges = this.host.listManagedChallenges()
    const managedChallengeIds = new Set<number>()

    for (const challenge of managedChallenges) {
      managedChallengeIds.add(challenge.challengeId)
      const baseRank = computeChallengeBaseRank(challenge.category, challenge.requiresContainer)
      const existing = this.rankByChallenge.get(challenge.challengeId)
      if (!existing) {
        this.rankByChallenge.set(challenge.challengeId, {
          challengeId: challenge.challengeId,
          baseRank,
          waitingSince: now,
          stopBurst: 0,
        })
        continue
      }

      existing.baseRank = baseRank

      if (existing.lastUnexpectedStopAt && existing.stopBurst > 0) {
        const elapsed = now - existing.lastUnexpectedStopAt
        if (elapsed >= RANK_STOP_RECOVERY_WINDOW_MS) {
          const recovered = Math.floor(elapsed / RANK_STOP_RECOVERY_WINDOW_MS)
          existing.stopBurst = Math.max(0, existing.stopBurst - recovered)
          existing.lastUnexpectedStopAt += recovered * RANK_STOP_RECOVERY_WINDOW_MS
        }
      }

      if (existing.cooldownUntil !== undefined && existing.cooldownUntil <= now) {
        existing.cooldownUntil = undefined
      }
    }

    for (const challengeId of this.rankByChallenge.keys()) {
      if (managedChallengeIds.has(challengeId)) {
        continue
      }

      this.rankByChallenge.delete(challengeId)
    }

    const activeChallengeIds = new Set(
      this.host.listInflightDispatchTasks().map((task) => task.challengeId),
    )
    for (const [challengeId, rankState] of this.rankByChallenge) {
      if (activeChallengeIds.has(challengeId)) {
        rankState.activeSince ??= now
        rankState.queuedSince ??= now
      } else {
        rankState.activeSince = undefined
      }
    }
  }

  private handleUnexpectedSolverStop(event: UnexpectedSolverStopEvent) {
    if (this.expectedStopTaskIds.delete(event.taskId)) {
      return
    }

    const progress = this.host
      .listSolverProgressStates()
      .find((state) => state.challengeId === event.challengeId)
    if (progress?.status === "solved") {
      return
    }

    const rankState = this.rankByChallenge.get(event.challengeId)
    if (!rankState) {
      return
    }

    const now = Date.now()
    rankState.stopBurst = Math.min(rankState.stopBurst + 1, RANK_STOP_BURST_LIMIT + 2)
    rankState.lastUnexpectedStopAt = now
    rankState.waitingSince = now
    if (rankState.stopBurst >= RANK_STOP_BURST_LIMIT) {
      rankState.cooldownUntil = now + RANK_STOP_COOLDOWN_MS
    }

    this.scheduleRebalance(true)
    this.host.notifyStateChanged()
  }

  private computeRankedCandidates(now: number): RankedCandidate[] {
    const result: RankedCandidate[] = []
    for (const challenge of this.host.listManagedChallenges()) {
      if (!this.isAutoQueueEligible(challenge.challengeId)) {
        continue
      }

      const rankState = this.rankByChallenge.get(challenge.challengeId)
      if (!rankState) {
        continue
      }

      if (rankState.cooldownUntil !== undefined && rankState.cooldownUntil > now) {
        continue
      }

      const rank = computeChallengeRank(rankState, now, rankState.queuedSince !== undefined)
      result.push({
        challengeId: challenge.challengeId,
        rank,
      })
    }

    result.sort((left, right) => right.rank - left.rank || left.challengeId - right.challengeId)
    return result
  }

  private resolveAvailableDispatchSlots(input: { candidateCount: number; inflightCount: number }) {
    if (input.candidateCount <= 0) {
      return 0
    }

    const schedulerState = this.host.getSchedulerState()
    const solverCapacity = schedulerState.registeredSolverCount
    if (solverCapacity <= 0) {
      return 0
    }

    const solverAvailableSlots = Math.max(0, solverCapacity - input.inflightCount)
    if (solverAvailableSlots <= 0) {
      return 0
    }

    const modelState = this.host.getModelPoolState()
    const resolvedModelAvailable =
      typeof modelState.totalAvailable === "number"
        ? modelState.totalAvailable
        : Math.max(0, modelState.totalCapacity - input.inflightCount)
    const modelAvailableSlots = Math.max(0, Math.floor(resolvedModelAvailable))
    if (modelAvailableSlots <= 0) {
      return 0
    }

    const candidateAvailableSlots = Math.max(0, input.candidateCount - input.inflightCount)

    return Math.min(candidateAvailableSlots, solverAvailableSlots, modelAvailableSlots)
  }

  private resolveContainerLimit() {
    const { maxConcurrentContainers } = this.host.getDispatchLimits()
    if (!Number.isFinite(maxConcurrentContainers)) {
      return Number.POSITIVE_INFINITY
    }

    return Math.max(1, Math.floor(maxConcurrentContainers))
  }

  private countInflightContainerTasks(
    inflightTasks: DispatchTask[],
    requiresContainerByChallengeId: Map<number, boolean>,
    containerActiveByChallengeId: Map<number, boolean>,
  ) {
    let containerTaskCount = 0
    for (const task of inflightTasks) {
      const requiresContainer = requiresContainerByChallengeId.get(task.challengeId) ?? true
      const hasActiveContainer = containerActiveByChallengeId.get(task.challengeId) ?? false
      if (requiresContainer && !hasActiveContainer) {
        containerTaskCount += 1
      }
    }

    return containerTaskCount
  }

  private trimAutoContainerIntents(
    requiresContainerByChallengeId: Map<number, boolean>,
    containerActiveByChallengeId: Map<number, boolean>,
    maxNewContainerIntents: number,
  ) {
    if (!Number.isFinite(maxNewContainerIntents)) {
      return
    }

    let remaining = Math.max(0, Math.floor(maxNewContainerIntents))
    let changed = false
    for (const intent of this.listPendingIntentsSnapshot()) {
      if (intent.source !== "auto") {
        continue
      }

      const requiresContainer = requiresContainerByChallengeId.get(intent.challengeId) ?? true
      const hasActiveContainer = containerActiveByChallengeId.get(intent.challengeId) ?? false
      if (!requiresContainer || hasActiveContainer) {
        continue
      }

      if (remaining > 0) {
        remaining -= 1
        continue
      }

      this.pendingIntents.delete(intent.taskId)
      changed = true
    }

    if (changed) {
      this.host.notifyStateChanged()
    }
  }

  private isAutoQueueEligible(challengeId: number) {
    const progress = this.host
      .listSolverProgressStates()
      .find((state) => state.challengeId === challengeId)

    return progress?.status !== "solved" && progress?.status !== "blocked"
  }
}

function resolveChallengeIdFromPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return undefined
  }

  const challengeId = (payload as { challenge?: unknown }).challenge
  return typeof challengeId === "number" && Number.isFinite(challengeId) ? challengeId : undefined
}
