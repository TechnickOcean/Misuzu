export type ContestBinding =
  | {
      mode: "auto"
    }
  | {
      mode: "id"
      value: number
    }
  | {
      mode: "title"
      value: string
    }
  | {
      mode: "url"
      value: string
    }
export type AuthMode = "manual" | "cookie" | "token" | "credentials"
export interface PluginAuthConfig {
  mode: AuthMode
  cookie?: string
  bearerToken?: string
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
export interface CTFPlatformPlugin {
  meta: {
    id: string
    name: string
  }
  setup(config: PluginConfig): Promise<void>
  login(auth?: PluginAuthConfig): Promise<AuthSession>
  refreshAuth(session: AuthSession): Promise<AuthSession>
  ensureAuthenticated(): Promise<AuthSession>
  getAuthSession(): AuthSession | null
  listContests(): Promise<ContestSummary[]>
  bindContest(binding?: ContestBinding): Promise<ContestSummary>
  listChallenges(): Promise<ChallengeSummary[]>
  getChallenge(challengeId: number): Promise<ChallengeDetail>
  submitFlagRaw(challengeId: number, flag: string): Promise<SubmitResult>
  pollUpdates(cursor?: string): Promise<PollResult>
  openContainer?(challengeId: number): Promise<ChallengeDetail>
  destroyContainer?(challengeId: number): Promise<ChallengeDetail>
}
