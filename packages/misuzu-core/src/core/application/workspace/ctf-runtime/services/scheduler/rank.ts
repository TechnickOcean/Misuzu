export const RANK_REBALANCE_INTERVAL_MS = 15_000
export const RANK_ENQUEUE_BOOST = 12
export const RANK_QUEUE_DECAY_PER_MINUTE = 0.25
export const RANK_WAIT_GAIN_PER_MINUTE = 0.4
export const RANK_STOP_PENALTY = 8
export const RANK_SWAP_MARGIN = 4
export const RANK_MIN_RUN_SLICE_MS = 12 * 60_000
export const RANK_HARD_CAP_MS = 90 * 60_000
export const RANK_HARD_COOLDOWN_MS = 15 * 60_000
export const RANK_STOP_BURST_LIMIT = 5
export const RANK_STOP_COOLDOWN_MS = 20 * 60_000
export const RANK_STOP_RECOVERY_WINDOW_MS = 18 * 60_000

const RANK_NO_CONTAINER_BONUS = 6
const RANK_CATEGORY_BASE: Record<string, number> = {
  web: 30,
  re: 24,
  pwn: 20,
  other: 16,
  crypto: 12,
  misc: 8,
}

export interface ChallengeRankState {
  challengeId: number
  baseRank: number
  waitingSince: number
  queuedSince?: number
  activeSince?: number
  stopBurst: number
  lastUnexpectedStopAt?: number
  cooldownUntil?: number
}

export interface RankedCandidate {
  challengeId: number
  rank: number
}

export function computeChallengeBaseRank(category: string, requiresContainer: boolean | undefined) {
  const normalizedCategory = normalizeChallengeCategory(category)
  const categoryRank = RANK_CATEGORY_BASE[normalizedCategory] ?? RANK_CATEGORY_BASE.other
  const containerBonus = requiresContainer === false ? RANK_NO_CONTAINER_BONUS : 0
  return categoryRank + containerBonus
}

export function computeChallengeRank(state: ChallengeRankState, now: number, queued: boolean) {
  const penalty = state.stopBurst * RANK_STOP_PENALTY
  if (queued) {
    const queuedMinutes = Math.max(0, now - (state.queuedSince ?? now)) / 60_000
    return (
      state.baseRank + RANK_ENQUEUE_BOOST - queuedMinutes * RANK_QUEUE_DECAY_PER_MINUTE - penalty
    )
  }

  const waitingMinutes = Math.max(0, now - state.waitingSince) / 60_000
  return state.baseRank + waitingMinutes * RANK_WAIT_GAIN_PER_MINUTE - penalty
}

function normalizeChallengeCategory(category: string) {
  const normalized = category.trim().toLowerCase()
  if (normalized.includes("web")) {
    return "web"
  }

  if (normalized === "re" || normalized.includes("reverse") || normalized === "binary") {
    return "re"
  }

  if (normalized.includes("pwn")) {
    return "pwn"
  }

  if (normalized.includes("crypto")) {
    return "crypto"
  }

  if (normalized.includes("misc")) {
    return "misc"
  }

  return "other"
}
