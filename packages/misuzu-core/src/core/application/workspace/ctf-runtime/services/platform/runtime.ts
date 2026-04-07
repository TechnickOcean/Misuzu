import type {
  AuthSession,
  PluginConfig,
  CTFPlatformPlugin,
} from "../../../../../../../plugins/index.ts"
import type { Logger } from "../../../../../infrastructure/logging/types.ts"
import { SolverHub } from "./hub.ts"
import { SyncService } from "./sync.ts"

export const DEFAULT_NOTICE_POLL_INTERVAL_MS = 60_000
export const DEFAULT_CHALLENGE_SYNC_INTERVAL_MS = 90_000

export interface RuntimeCronOptions {
  noticePollIntervalMs?: number
  challengeSyncIntervalMs?: number
}

export interface RuntimeInitOptions {
  pluginId?: string
  pluginConfig: PluginConfig
  solverPromptTemplate?: string
  plugin?: CTFPlatformPlugin
  cron?: RuntimeCronOptions
  startPaused?: boolean
  restore?: {
    authSession?: AuthSession
    contestId?: number
    noticeCursor?: string
  }
}

export interface RuntimeScheduler {
  registerCronJob: (name: string, intervalMs: number, handler: () => Promise<void>) => void
}

export interface RuntimeOrchestratorDeps {
  logger: Logger
  solverHub: SolverHub
  syncService: SyncService
}

export class RuntimeOrchestrator {
  private readonly logger: Logger
  private readonly solverHub: SolverHub
  private readonly syncService: SyncService

  constructor(deps: RuntimeOrchestratorDeps) {
    this.logger = deps.logger
    this.solverHub = deps.solverHub
    this.syncService = deps.syncService
  }

  async initialize(options: RuntimeInitOptions, scheduler: RuntimeScheduler) {
    await this.solverHub.initialize(options)
    await this.syncService.syncChallengesOnce()

    const noticePollIntervalMs =
      options.cron?.noticePollIntervalMs ?? DEFAULT_NOTICE_POLL_INTERVAL_MS
    const challengeSyncIntervalMs =
      options.cron?.challengeSyncIntervalMs ?? DEFAULT_CHALLENGE_SYNC_INTERVAL_MS

    scheduler.registerCronJob("platform-notices", noticePollIntervalMs, async () => {
      await this.syncService.syncNoticesOnce()
    })

    scheduler.registerCronJob("platform-challenges", challengeSyncIntervalMs, async () => {
      await this.syncService.syncChallengesOnce()
    })

    this.logger.info("Platform runtime initialized", {
      pluginId: this.solverHub.getPluginId(),
      challengeCount: this.solverHub.getManagedChallengeIds().length,
      noticePollIntervalMs,
      challengeSyncIntervalMs,
    })
  }

  async syncChallengesOnce() {
    await this.syncService.syncChallengesOnce()
  }

  async syncNoticesOnce() {
    await this.syncService.syncNoticesOnce()
  }
}
