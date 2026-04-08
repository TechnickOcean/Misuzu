import type { ContestUpdate } from "../../../../../../../plugins/index.ts"
import type { Logger } from "../../../../../infrastructure/logging/types.ts"
import { SolverHub } from "./hub.ts"
import { isModelPoolError } from "../model/pool.ts"

const HINT_LIKE_KEYWORDS = [
  "hint",
  "fix",
  "patch",
  "update",
  "notice",
  "announcement",
  "container",
  "instance",
  "attachment",
  "flag",
  "提示",
  "修复",
  "更新",
  "公告",
  "容器",
  "实例",
  "附件",
] as const

export interface SyncServiceDeps {
  logger: Logger
  solverHub: SolverHub
}

export class SyncService {
  private readonly logger: Logger
  private readonly solverHub: SolverHub

  constructor(deps: SyncServiceDeps) {
    this.logger = deps.logger
    this.solverHub = deps.solverHub
  }

  async syncChallengesOnce() {
    const latestChallenges = await this.solverHub.listChallenges()
    const latestChallengeIds = new Set<number>()

    for (const challenge of latestChallenges) {
      latestChallengeIds.add(challenge.id)

      const existing = this.solverHub.getChallengeBinding(challenge.id)
      if (!existing) {
        try {
          await this.solverHub.ensureChallengeSolver(challenge)
        } catch (error) {
          if (!isModelPoolError(error)) {
            throw error
          }

          this.logger.warn(
            "Skip challenge solver creation because model pool cannot allocate model",
            {
              challengeId: challenge.id,
              reason: error.code,
            },
          )
        }
        continue
      }

      if (!existing.solver && !this.solverHub.isChallengeSolved(challenge.id)) {
        await this.solverHub.ensureChallengeSolver(challenge)
      }

      this.solverHub.updateChallengeMetadata(challenge)
      await this.solverHub.refreshChallengeDetail(challenge.id)
    }

    for (const binding of this.solverHub.getChallengeBindings()) {
      if (!latestChallengeIds.has(binding.challenge.id)) {
        this.logger.warn("Challenge removed from platform listing", {
          challengeId: binding.challenge.id,
        })
      }
    }
  }

  async syncNoticesOnce() {
    const result = await this.solverHub.pollUpdates(this.solverHub.getNoticeCursor())
    this.solverHub.setNoticeCursor(result.cursor)
    const indexedBindings = indexChallengeBindings(this.solverHub.getChallengeBindings())

    for (const update of result.updates) {
      if (!isHintLikeUpdate(update)) {
        continue
      }

      const normalizedMessage = normalizeForKeywordMatch(update.message)
      for (const indexedBinding of indexedBindings) {
        if (!normalizedMessage.includes(indexedBinding.normalizedTitle)) {
          continue
        }

        indexedBinding.binding.solver?.steer(
          [
            `Potential hint/update detected for challenge [${indexedBinding.binding.challenge.id}] ${indexedBinding.binding.challenge.title}.`,
            `Update type: ${update.type}`,
            `Update message: ${update.message}`,
            "Please validate if this affects your current solving strategy.",
          ].join("\n"),
        )
      }
    }
  }
}

function isHintLikeUpdate(update: ContestUpdate) {
  const message = update.message.toLowerCase()
  return HINT_LIKE_KEYWORDS.some((keyword) => message.includes(keyword.toLowerCase()))
}

function normalizeForKeywordMatch(input: string) {
  return input
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fa5]/g, "")
}

function indexChallengeBindings(bindings: ReturnType<SolverHub["getChallengeBindings"]>) {
  return bindings
    .map((binding) => ({
      binding,
      normalizedTitle: normalizeForKeywordMatch(binding.challenge.title),
    }))
    .filter((entry) => entry.normalizedTitle.length > 0)
}
