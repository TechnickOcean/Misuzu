export type ContestBinding =
  | { mode: "auto" }
  | { mode: "id"; value: number }
  | { mode: "title"; value: string }
  | { mode: "url"; value: string }

export type AuthMode = "manual" | "credentials"

export interface PluginAuthConfig {
  mode: AuthMode
  username?: string
  password?: string
  loginUrl?: string
  authCheckUrl?: string
  timeoutSec?: number
}

export interface AuthSession {
  mode: AuthMode
  cookie?: string
  bearerToken?: string
  expiresAt?: number
  refreshable: boolean
}

export interface PluginConfig {
  baseUrl: string
  contest: ContestBinding
  auth?: PluginAuthConfig
  maxConcurrentContainers: number
}

export interface PlatformRequestContext {
  session: AuthSession
  contestId: number
}

export interface ContestSummary {
  id: number
  title: string
  start?: number
  end?: number
}

export interface ChallengeSummary {
  id: number
  title: string
  category: string
  score: number
  solvedCount: number
}

export interface AttachmentRef {
  name: string
  url: string
  kind: "external_url" | "direct_download"
}

export interface ChallengeDetail {
  id: number
  title: string
  category: string
  score: number
  content: string
  hints: string[]
  requiresContainer: boolean
  attempts: number
  attachments: AttachmentRef[]
  container?: {
    entry?: string | null
    closeTime?: number | null
  }
}

export interface SubmitResult {
  submissionId?: number
  status: string
  accepted: boolean
}

export interface ContestUpdate {
  id: number
  time: number
  type: string
  message: string
}

export interface PollResult {
  cursor?: string
  updates: ContestUpdate[]
}

export class PlatformAuthError extends Error {
  constructor(message = "Platform authentication required") {
    super(message)
    this.name = "PlatformAuthError"
  }
}

export function isPlatformAuthError(error: unknown): error is PlatformAuthError {
  if (!error || typeof error !== "object") {
    return false
  }

  return (error as { name?: string }).name === "PlatformAuthError"
}

export interface CTFPlatformPlugin {
  meta: {
    id: string
    name: string
  }
  setup(config: PluginConfig): Promise<void>
  login(auth?: PluginAuthConfig): Promise<AuthSession>
  validateSession(session: AuthSession): Promise<void>
  listContests(session: AuthSession): Promise<ContestSummary[]>
  listChallenges(context: PlatformRequestContext): Promise<ChallengeSummary[]>
  getChallenge(context: PlatformRequestContext & { challengeId: number }): Promise<ChallengeDetail>
  submitFlagRaw(
    context: PlatformRequestContext & {
      challengeId: number
      flag: string
    },
  ): Promise<SubmitResult>
  pollUpdates(context: PlatformRequestContext & { cursor?: string }): Promise<PollResult>
  openContainer?(
    context: PlatformRequestContext & { challengeId: number },
  ): Promise<ChallengeDetail>
  destroyContainer?(
    context: PlatformRequestContext & { challengeId: number },
  ): Promise<ChallengeDetail>
}
