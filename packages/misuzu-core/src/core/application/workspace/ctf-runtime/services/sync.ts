import type { ContestUpdate } from "../../../../../../../../plugins/index.ts"
import type { Logger } from "../../../../infrastructure/logging/types.ts"
import { SolverHub } from "./solver-hub.ts"

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
    const plugin = this.solverHub.getPlugin()
    const latestChallenges = await plugin.listChallenges()
    const latestChallengeIds = new Set<number>()

    for (const challenge of latestChallenges) {
      latestChallengeIds.add(challenge.id)

      const existing = this.solverHub.getChallengeBinding(challenge.id)
      if (!existing) {
        await this.solverHub.ensureChallengeSolver(challenge)
        continue
      }

      this.solverHub.updateChallengeMetadata(challenge)
    }

    for (const binding of this.solverHub.getChallengeBindings()) {
      if (!latestChallengeIds.has(binding.challenge.id)) {
        this.logger.warn("[CTFRuntimeWorkspace] Challenge removed from platform listing", {
          challengeId: binding.challenge.id,
        })
      }
    }
  }

  async syncNoticesOnce() {
    const plugin = this.solverHub.getPlugin()
    const result = await plugin.pollUpdates(this.solverHub.getNoticeCursor())
    this.solverHub.setNoticeCursor(result.cursor)

    for (const update of result.updates) {
      if (!isHintLikeUpdate(update)) {
        continue
      }

      const normalizedMessage = normalizeForKeywordMatch(update.message)
      for (const binding of this.solverHub.getChallengeBindings()) {
        const normalizedTitle = normalizeForKeywordMatch(binding.challenge.title)
        if (normalizedTitle.length === 0) {
          continue
        }

        if (!normalizedMessage.includes(normalizedTitle)) {
          continue
        }

        binding.solver.steer(
          [
            `Potential hint/update detected for challenge [${binding.challenge.id}] ${binding.challenge.title}.`,
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
