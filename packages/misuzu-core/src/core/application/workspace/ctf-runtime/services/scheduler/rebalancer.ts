import type { PersistedCTFRuntimeManagedChallenge } from "../../state.ts"
import type { SolverTaskCancelResult } from "./queue.ts"
import type { UnexpectedSolverStopEvent } from "../platform/hub.ts"
import {
  RANK_HARD_CAP_MS,
  RANK_HARD_COOLDOWN_MS,
  RANK_MIN_RUN_SLICE_MS,
  RANK_REBALANCE_INTERVAL_MS,
  RANK_STOP_BURST_LIMIT,
  RANK_STOP_COOLDOWN_MS,
  RANK_STOP_RECOVERY_WINDOW_MS,
  RANK_SWAP_MARGIN,
  type ChallengeRankState,
  type RankedCandidate,
  computeChallengeBaseRank,
  computeChallengeRank,
} from "./rank.ts"

interface SchedulerTaskLike {
  taskId: string
  payload: unknown
}

interface InflightSchedulerTaskLike {
  task: SchedulerTaskLike
}

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

export interface RuntimeRankOrchestratorHost {
  listManagedChallenges(): PersistedCTFRuntimeManagedChallenge[]
  getChallengeSolver(challengeId: number): unknown
  listSolverProgressStates(): ChallengeProgressLike[]
  listPendingSchedulerTasks(): SchedulerTaskLike[]
  listInflightSchedulerTasks(): InflightSchedulerTaskLike[]
  cancelSchedulerTask(taskId: string): SolverTaskCancelResult | undefined
  enqueueTask(payload: unknown, taskId?: string): Promise<unknown>
  getSchedulerState(): RuntimeSchedulerStateLike
  getModelPoolState(): ModelPoolStateLike
  isTaskDispatchPaused(): boolean
  setUnexpectedSolverStopListener(listener: (event: UnexpectedSolverStopEvent) => void): void
  notifyStateChanged(): void
}

export class RuntimeRankOrchestrator {
  private readonly autoQueuedChallenges = new Set<number>()
  private readonly expectedStopTaskIds = new Set<string>()
  private readonly rankByChallenge = new Map<number, ChallengeRankState>()
  private taskCounter = 0
  private dispatchAutoManaged = false
  private rankRebalanceRunning = false
  private rankRebalanceTimer?: NodeJS.Timeout

  constructor(private readonly host: RuntimeRankOrchestratorHost) {}

  initialize() {
    this.host.setUnexpectedSolverStopListener((event) => {
      this.handleUnexpectedSolverStop(event)
    })
    this.syncRankStates()
    this.seedAutoQueuedChallenges()
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
  }

  isDispatchAutoManaged() {
    return this.dispatchAutoManaged
  }

  onManagedChallengesChanged() {
    this.syncRankStates()
  }

  scheduleRebalance(immediate = false) {
    if (this.rankRebalanceRunning) {
      return
    }

    const run = async () => {
      this.rankRebalanceRunning = true
      try {
        await this.rebalanceManagedChallenges()
      } finally {
        this.rankRebalanceRunning = false
      }
    }

    if (immediate) {
      void run()
      return
    }

    void run()
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

  private async rebalanceManagedChallenges() {
    if (!this.dispatchAutoManaged) {
      return
    }

    if (this.host.isTaskDispatchPaused()) {
      return
    }

    this.syncRankStates()

    const now = Date.now()
    const pendingTaskByChallengeId = new Map<number, string>()
    for (const task of this.host.listPendingSchedulerTasks()) {
      const challengeId = resolveChallengeIdFromPayload(task.payload)
      if (challengeId === undefined || pendingTaskByChallengeId.has(challengeId)) {
        continue
      }

      pendingTaskByChallengeId.set(challengeId, task.taskId)
    }

    const inflightTaskByChallengeId = new Map<number, string>()
    for (const inflight of this.host.listInflightSchedulerTasks()) {
      const challengeId = resolveChallengeIdFromPayload(inflight.task.payload)
      if (challengeId === undefined || inflightTaskByChallengeId.has(challengeId)) {
        continue
      }

      inflightTaskByChallengeId.set(challengeId, inflight.task.taskId)
    }

    const candidates = this.computeRankedCandidates(now)
    const targetCount = this.resolveTargetConcurrency(candidates.length)
    const targetCandidates = candidates.slice(0, targetCount)
    const targetIds = new Set(targetCandidates.map((candidate) => candidate.challengeId))
    const candidateRankById = new Map(
      targetCandidates.map((candidate) => [candidate.challengeId, candidate.rank]),
    )

    for (const [challengeId, taskId] of pendingTaskByChallengeId) {
      if (targetIds.has(challengeId)) {
        continue
      }

      const cancelled = this.host.cancelSchedulerTask(taskId)
      if (cancelled === "pending") {
        this.autoQueuedChallenges.delete(challengeId)
        const rankState = this.rankByChallenge.get(challengeId)
        if (rankState) {
          rankState.queuedSince = undefined
          rankState.waitingSince = now
        }
      }
    }

    let highestWaitingRank = Number.NEGATIVE_INFINITY
    for (const candidate of targetCandidates) {
      if (inflightTaskByChallengeId.has(candidate.challengeId)) {
        continue
      }

      highestWaitingRank = Math.max(highestWaitingRank, candidate.rank)
    }

    for (const [challengeId, taskId] of inflightTaskByChallengeId) {
      const rankState = this.rankByChallenge.get(challengeId)
      const activeDurationMs = rankState?.activeSince ? now - rankState.activeSince : 0
      const activeRank =
        candidateRankById.get(challengeId) ??
        (rankState ? computeChallengeRank(rankState, now, true) : Number.NEGATIVE_INFINITY)

      let shouldAbort = false
      if (activeDurationMs >= RANK_HARD_CAP_MS) {
        shouldAbort = true
        if (rankState) {
          rankState.cooldownUntil = now + RANK_HARD_COOLDOWN_MS
        }
      } else if (
        !targetIds.has(challengeId) &&
        activeDurationMs >= RANK_MIN_RUN_SLICE_MS &&
        highestWaitingRank >= activeRank + RANK_SWAP_MARGIN
      ) {
        shouldAbort = true
      }

      if (!shouldAbort) {
        continue
      }

      this.expectedStopTaskIds.add(taskId)
      const cancelled = this.host.cancelSchedulerTask(taskId)
      if (cancelled !== "inflight") {
        this.expectedStopTaskIds.delete(taskId)
      }
    }

    for (const candidate of targetCandidates) {
      if (
        pendingTaskByChallengeId.has(candidate.challengeId) ||
        inflightTaskByChallengeId.has(candidate.challengeId) ||
        this.autoQueuedChallenges.has(candidate.challengeId)
      ) {
        continue
      }

      this.enqueueAutoChallenge(candidate.challengeId)
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
      this.autoQueuedChallenges.delete(challengeId)
    }

    const queuedChallengeIds = new Set<number>()
    const activeChallengeIds = new Set<number>()

    for (const task of this.host.listPendingSchedulerTasks()) {
      const challengeId = resolveChallengeIdFromPayload(task.payload)
      if (challengeId !== undefined) {
        queuedChallengeIds.add(challengeId)
      }
    }

    for (const inflight of this.host.listInflightSchedulerTasks()) {
      const challengeId = resolveChallengeIdFromPayload(inflight.task.payload)
      if (challengeId === undefined) {
        continue
      }

      queuedChallengeIds.add(challengeId)
      activeChallengeIds.add(challengeId)
    }

    for (const [challengeId, rankState] of this.rankByChallenge) {
      const isQueued = queuedChallengeIds.has(challengeId)
      const wasQueued = rankState.queuedSince !== undefined

      if (isQueued) {
        rankState.queuedSince ??= now
        this.autoQueuedChallenges.add(challengeId)
      } else {
        rankState.queuedSince = undefined
        if (wasQueued) {
          rankState.waitingSince = now
        }
        this.autoQueuedChallenges.delete(challengeId)
      }

      const isActive = activeChallengeIds.has(challengeId)
      if (isActive) {
        rankState.activeSince ??= now
      } else {
        rankState.activeSince = undefined
      }
    }
  }

  private seedAutoQueuedChallenges() {
    this.autoQueuedChallenges.clear()
    for (const task of this.host.listPendingSchedulerTasks()) {
      const challengeId = resolveChallengeIdFromPayload(task.payload)
      if (challengeId !== undefined) {
        this.autoQueuedChallenges.add(challengeId)
      }
    }

    for (const inflight of this.host.listInflightSchedulerTasks()) {
      const challengeId = resolveChallengeIdFromPayload(inflight.task.payload)
      if (challengeId !== undefined) {
        this.autoQueuedChallenges.add(challengeId)
      }
    }
  }

  private enqueueAutoChallenge(challengeId: number) {
    if (this.autoQueuedChallenges.has(challengeId) || !this.isAutoQueueEligible(challengeId)) {
      return
    }

    const taskId = `auto-${String(challengeId)}-${String(++this.taskCounter)}`
    const now = Date.now()
    const rankState = this.rankByChallenge.get(challengeId)
    if (rankState) {
      rankState.queuedSince = now
    }

    this.autoQueuedChallenges.add(challengeId)

    void this.host
      .enqueueTask({ challenge: challengeId }, taskId)
      .then(() => {
        this.handleAutoChallengeTaskSettled(challengeId, taskId)
      })
      .catch(() => {
        this.handleAutoChallengeTaskSettled(challengeId, taskId)
      })
  }

  private handleAutoChallengeTaskSettled(challengeId: number, taskId: string) {
    this.autoQueuedChallenges.delete(challengeId)

    const rankState = this.rankByChallenge.get(challengeId)
    if (rankState) {
      rankState.queuedSince = undefined
      rankState.activeSince = undefined
      rankState.waitingSince = Date.now()
    }

    this.expectedStopTaskIds.delete(taskId)

    if (this.dispatchAutoManaged && !this.host.isTaskDispatchPaused()) {
      this.scheduleRebalance(true)
    }

    this.host.notifyStateChanged()
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

    if (this.dispatchAutoManaged) {
      this.scheduleRebalance(true)
    }

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

  private resolveTargetConcurrency(candidateCount: number) {
    if (candidateCount <= 0) {
      return 0
    }

    const schedulerState = this.host.getSchedulerState()
    const solverCapacity = schedulerState.registeredSolverCount
    if (solverCapacity <= 0) {
      return 0
    }

    const modelState = this.host.getModelPoolState()
    const modelCapacity =
      typeof modelState.totalAvailable === "number"
        ? modelState.totalAvailable
        : modelState.totalCapacity
    if (modelCapacity <= 0) {
      return 0
    }

    return Math.min(candidateCount, solverCapacity, modelCapacity)
  }

  private isAutoQueueEligible(challengeId: number) {
    if (!this.host.getChallengeSolver(challengeId)) {
      return false
    }

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
