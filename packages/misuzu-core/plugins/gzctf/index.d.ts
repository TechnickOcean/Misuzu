import type {
  AuthSession,
  CTFPlatformPlugin,
  ChallengeDetail,
  ChallengeSummary,
  ContestBinding,
  ContestSummary,
  PluginAuthConfig,
  PluginConfig,
  PollResult,
} from "../protocol.ts"
type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>
export declare class GzctfPlugin implements CTFPlatformPlugin {
  readonly meta: {
    id: string
    name: string
  }
  private readonly fetchImpl
  private config?
  private baseUrl
  private contestId?
  private authSession
  constructor(fetchImpl?: FetchLike)
  setup(config: PluginConfig): Promise<void>
  login(auth?: PluginAuthConfig): Promise<AuthSession>
  refreshAuth(session: AuthSession): Promise<AuthSession>
  ensureAuthenticated(): Promise<AuthSession>
  getAuthSession(): AuthSession | null
  getPersistedState(): {
    authSession: AuthSession | null
    contestId: number | undefined
  }
  restoreFromPersistedState(state: Record<string, unknown>): void
  listContests(): Promise<
    {
      id: number
      title: string
      start: number | undefined
      end: number | undefined
    }[]
  >
  bindContest(binding?: ContestBinding): Promise<ContestSummary>
  listChallenges(): Promise<ChallengeSummary[]>
  getChallenge(challengeId: number): Promise<ChallengeDetail>
  submitFlagRaw(
    challengeId: number,
    flag: string,
  ): Promise<
    | {
        status: string
        accepted: boolean
        submissionId?: undefined
      }
    | {
        submissionId: number
        status: string
        accepted: boolean
      }
  >
  pollUpdates(cursor?: string): Promise<PollResult>
  openContainer(challengeId: number): Promise<ChallengeDetail>
  destroyContainer(challengeId: number): Promise<ChallengeDetail>
  private requireContestId
  private mapChallengeDetail
  private ensureSessionAuthenticated
  private request
  private requestText
  private fetchWithRetry
  private fetchWithSession
  private resolveUrl
  private withAuthHeaders
  private sleep
}
export declare function createGzctfPlugin(fetchImpl?: FetchLike): GzctfPlugin
