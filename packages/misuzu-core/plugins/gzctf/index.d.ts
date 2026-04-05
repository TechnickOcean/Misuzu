import type {
  AuthSession,
  CTFPlatformPlugin,
  ChallengeDetail,
  PlatformRequestContext,
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
  private baseUrl
  constructor(fetchImpl?: FetchLike)
  setup(config: PluginConfig): Promise<void>
  login(auth?: PluginAuthConfig): Promise<AuthSession>
  validateSession(session: AuthSession): Promise<void>
  listContests(session: AuthSession): Promise<
    {
      id: number
      title: string
      start: number | undefined
      end: number | undefined
    }[]
  >
  listChallenges(context: PlatformRequestContext): Promise<
    {
      id: number
      title: string
      category: string
      score: number
      solvedCount: number
    }[]
  >
  getChallenge(context: PlatformRequestContext & { challengeId: number }): Promise<ChallengeDetail>
  submitFlagRaw(
    context: PlatformRequestContext & {
      challengeId: number
      flag: string
    },
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
  pollUpdates(context: PlatformRequestContext & { cursor?: string }): Promise<PollResult>
  openContainer(context: PlatformRequestContext & { challengeId: number }): Promise<ChallengeDetail>
  destroyContainer(
    context: PlatformRequestContext & { challengeId: number },
  ): Promise<ChallengeDetail>
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
