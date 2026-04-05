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
import { openHeadedAuth } from "../utils.ts"

interface GzctfContest {
  id: number
  title: string
  start?: number
  end?: number
}

interface GzctfGameListResponse {
  data: GzctfContest[]
}

interface GzctfChallengeListItem {
  id: number
  title: string
  category: string
  score: number
  solved: number
}

interface GzctfChallengeDetailsResponse {
  challenges: Record<string, GzctfChallengeListItem[]>
}

interface GzctfChallengeDetailResponse {
  id: number
  title: string
  content: string
  category: string
  hints: Array<string | { content?: string; text?: string }>
  score: number
  type: string
  context: {
    closeTime?: number | null
    instanceEntry?: string | null
    url?: string | null
  }
  attempts: number
}

interface GzctfNotice {
  id: number
  time: number
  type: string
  values?: string[]
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

const ACCEPTED_STATUSES = new Set(["Correct", "Accepted", "Solved", "Success"])
const FINISHED_STATUSES = new Set([
  "Correct",
  "Accepted",
  "Solved",
  "Success",
  "WrongAnswer",
  "AlreadySolved",
  "TooManyAttempts",
  "Forbidden",
])

function trimTrailingSlash(input: string) {
  return input.endsWith("/") ? input.slice(0, -1) : input
}

function parseContestIdFromUrl(url: string) {
  const match = /\/games\/(\d+)/.exec(url)
  if (!match) {
    throw new Error(`Unable to parse contest id from URL: ${url}`)
  }
  return Number(match[1])
}

function normalizeHint(hint: string | { content?: string; text?: string }) {
  if (typeof hint === "string") {
    return hint
  }
  return hint.content ?? hint.text ?? ""
}

function isAuthSession(value: unknown): value is AuthSession {
  if (!value || typeof value !== "object") {
    return false
  }

  const candidate = value as Partial<AuthSession>
  if (
    candidate.mode !== "manual" &&
    candidate.mode !== "cookie" &&
    candidate.mode !== "token" &&
    candidate.mode !== "credentials"
  ) {
    return false
  }

  return typeof candidate.refreshable === "boolean"
}

function isContainerActive(detail: GzctfChallengeDetailResponse) {
  return Boolean(detail.context?.instanceEntry)
}

function isAuthRejected(status: number) {
  return status === 401 || status === 403
}

function parseJsonOrRaw<T>(text: string) {
  if (!text) {
    return undefined as T
  }

  try {
    return JSON.parse(text) as T
  } catch {
    return text as T
  }
}

export class GzctfPlugin implements CTFPlatformPlugin {
  readonly meta = {
    id: "gzctf",
    name: "GZ::CTF",
  }

  private readonly fetchImpl: FetchLike
  private config?: PluginConfig
  private baseUrl = ""
  private contestId?: number
  private authSession: AuthSession | null = null

  constructor(fetchImpl: FetchLike = fetch) {
    this.fetchImpl = fetchImpl
  }

  async setup(config: PluginConfig) {
    this.config = config
    this.baseUrl = trimTrailingSlash(config.baseUrl)

    if (!this.authSession) {
      this.authSession = await this.login(config.auth)
    }

    await this.ensureAuthenticated()

    if (typeof this.contestId === "number") {
      const contests = await this.listContests()
      if (!contests.some((contest) => contest.id === this.contestId)) {
        this.contestId = undefined
      }
    }

    if (!this.contestId) {
      await this.bindContest(config.contest)
    }
  }

  async login(auth: PluginAuthConfig = { mode: "manual" }): Promise<AuthSession> {
    switch (auth.mode) {
      case "manual": {
        const loginUrl = auth.loginUrl ?? `${this.baseUrl}/account/login`
        const authCheckUrl = auth.authCheckUrl ?? `${this.baseUrl}/api/account/profile`
        const result = await openHeadedAuth({
          loginUrl,
          authCheckUrl,
          timeoutSec: auth.timeoutSec,
        })

        return {
          mode: "cookie",
          cookie: result.cookieHeader,
          refreshable: false,
        }
      }
      case "cookie":
        if (!auth.cookie) {
          throw new Error("Cookie auth mode requires auth.cookie")
        }
        return {
          mode: "cookie",
          cookie: auth.cookie,
          refreshable: false,
        }
      case "token":
        if (!auth.bearerToken) {
          throw new Error("Token auth mode requires auth.bearerToken")
        }
        return {
          mode: "token",
          bearerToken: auth.bearerToken,
          refreshable: false,
        }
      case "credentials":
        throw new Error(
          "Credentials login is not supported for this adapter. Use manual auth mode to launch headed browser login.",
        )
    }
  }

  async refreshAuth(session: AuthSession): Promise<AuthSession> {
    if (session.mode === "cookie" || session.mode === "token") {
      await this.ensureSessionAuthenticated(session)
      this.authSession = session
      return session
    }

    throw new Error("Authentication expired. Manual login is required.")
  }

  async ensureAuthenticated(): Promise<AuthSession> {
    let session = this.authSession
    if (!session) {
      session = await this.login(this.config?.auth)
      this.authSession = session
    }

    await this.ensureSessionAuthenticated(session)
    return session
  }

  getAuthSession(): AuthSession | null {
    return this.authSession
  }

  getPersistedState() {
    return {
      authSession: this.authSession,
      contestId: this.contestId,
    }
  }

  restoreFromPersistedState(state: Record<string, unknown>) {
    if (isAuthSession(state.authSession)) {
      this.authSession = state.authSession
    }

    if (typeof state.contestId === "number" && Number.isInteger(state.contestId)) {
      this.contestId = state.contestId
    }
  }

  async listContests() {
    const response = await this.request<GzctfGameListResponse>("/api/game")
    return response.data.map((contest) => ({
      id: contest.id,
      title: contest.title,
      start: contest.start,
      end: contest.end,
    }))
  }

  async bindContest(binding: ContestBinding = { mode: "auto" }) {
    const contests = await this.listContests()
    if (contests.length === 0) {
      throw new Error("No contests found for this platform")
    }

    let selected: ContestSummary | undefined

    switch (binding.mode) {
      case "id":
        selected = contests.find((contest) => contest.id === binding.value)
        break
      case "title":
        selected = contests.find((contest) => contest.title === binding.value)
        break
      case "url": {
        const contestId = parseContestIdFromUrl(binding.value)
        selected = contests.find((contest) => contest.id === contestId)
        break
      }
      case "auto": {
        const now = Date.now()
        selected =
          contests.find(
            (contest) =>
              typeof contest.start === "number" &&
              typeof contest.end === "number" &&
              contest.start <= now &&
              now <= contest.end,
          ) ?? contests[0]
        break
      }
    }

    if (!selected) {
      throw new Error(`Unable to bind contest for mode: ${binding.mode}`)
    }

    this.contestId = selected.id
    return selected
  }

  async listChallenges() {
    const contestId = this.requireContestId()
    const response = await this.request<GzctfChallengeDetailsResponse>(
      `/api/game/${contestId}/details`,
    )

    const entries = Object.entries(response.challenges)
    const flattened: ChallengeSummary[] = []
    for (const [, challenges] of entries) {
      for (const challenge of challenges) {
        flattened.push({
          id: challenge.id,
          title: challenge.title,
          category: challenge.category,
          score: challenge.score,
          solvedCount: challenge.solved,
        })
      }
    }

    return flattened
  }

  async getChallenge(challengeId: number) {
    const contestId = this.requireContestId()
    const detail = await this.request<GzctfChallengeDetailResponse>(
      `/api/game/${contestId}/challenges/${challengeId}`,
    )

    return this.mapChallengeDetail(detail)
  }

  async submitFlagRaw(challengeId: number, flag: string) {
    const contestId = this.requireContestId()
    const submissionIdText = await this.requestText(
      `/api/game/${contestId}/challenges/${challengeId}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ flag }),
      },
    )

    const submissionId = Number(submissionIdText)
    if (!Number.isFinite(submissionId)) {
      return {
        status: submissionIdText,
        accepted: ACCEPTED_STATUSES.has(submissionIdText),
      }
    }

    for (let i = 0; i < 8; i += 1) {
      const status = await this.request<string>(
        `/api/game/${contestId}/challenges/${challengeId}/status/${submissionId}`,
      )

      if (FINISHED_STATUSES.has(status)) {
        return {
          submissionId,
          status,
          accepted: ACCEPTED_STATUSES.has(status),
        }
      }

      await this.sleep(700)
    }

    return {
      submissionId,
      status: "Pending",
      accepted: false,
    }
  }

  async pollUpdates(cursor?: string): Promise<PollResult> {
    const contestId = this.requireContestId()
    const notices = await this.request<GzctfNotice[]>(`/api/game/${contestId}/notices`)

    const lastSeenId = cursor ? Number(cursor) : 0
    const sorted = [...notices].sort((a, b) => a.id - b.id)
    const updates = sorted
      .filter((notice) => notice.id > lastSeenId)
      .map((notice) => ({
        id: notice.id,
        time: notice.time,
        type: notice.type,
        message: (notice.values ?? []).join(" "),
      }))

    const maxId = sorted.length > 0 ? sorted[sorted.length - 1].id : lastSeenId
    return {
      cursor: String(maxId),
      updates,
    }
  }

  async openContainer(challengeId: number): Promise<ChallengeDetail> {
    const contestId = this.requireContestId()
    const current = await this.request<GzctfChallengeDetailResponse>(
      `/api/game/${contestId}/challenges/${challengeId}`,
    )
    if (isContainerActive(current)) {
      return this.mapChallengeDetail(current)
    }

    await this.requestText(`/api/game/${contestId}/container/${challengeId}`, {
      method: "POST",
    })

    const updated = await this.request<GzctfChallengeDetailResponse>(
      `/api/game/${contestId}/challenges/${challengeId}`,
    )
    if (!isContainerActive(updated)) {
      throw new Error(`Container was not started for challenge ${challengeId}`)
    }

    return this.mapChallengeDetail(updated)
  }

  async destroyContainer(challengeId: number): Promise<ChallengeDetail> {
    const contestId = this.requireContestId()
    const current = await this.request<GzctfChallengeDetailResponse>(
      `/api/game/${contestId}/challenges/${challengeId}`,
    )
    if (!isContainerActive(current)) {
      return this.mapChallengeDetail(current)
    }

    await this.requestText(`/api/game/${contestId}/container/${challengeId}`, {
      method: "POST",
    })

    const updated = await this.request<GzctfChallengeDetailResponse>(
      `/api/game/${contestId}/challenges/${challengeId}`,
    )
    if (isContainerActive(updated)) {
      throw new Error(`Container was not destroyed for challenge ${challengeId}`)
    }

    return this.mapChallengeDetail(updated)
  }

  private requireContestId() {
    if (!this.contestId) {
      throw new Error("Contest is not bound. Call setup() or bindContest() first")
    }
    return this.contestId
  }

  private mapChallengeDetail(detail: GzctfChallengeDetailResponse): ChallengeDetail {
    const attachmentUrl = detail.context?.url ?? null
    const attachments = attachmentUrl
      ? [
          {
            name: "attachment",
            url: attachmentUrl,
            kind: (attachmentUrl.startsWith("http") ? "external_url" : "direct_download") as
              | "external_url"
              | "direct_download",
          },
        ]
      : []

    return {
      id: detail.id,
      title: detail.title,
      category: detail.category,
      score: detail.score,
      content: detail.content,
      hints: (detail.hints ?? []).map(normalizeHint).filter(Boolean),
      requiresContainer: detail.type === "DynamicContainer",
      attempts: detail.attempts,
      attachments,
      container: {
        entry: detail.context?.instanceEntry,
        closeTime: detail.context?.closeTime,
      },
    }
  }

  private async ensureSessionAuthenticated(session: AuthSession) {
    const response = await this.fetchWithSession("/api/account/profile", undefined, session)
    if (!response.ok) {
      throw new Error(`Authentication check failed (${response.status})`)
    }
    await response.text()
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchWithRetry(path, init)
    const text = await response.text()
    return parseJsonOrRaw<T>(text)
  }

  private async requestText(path: string, init?: RequestInit) {
    const response = await this.fetchWithRetry(path, init)
    return response.text()
  }

  private async fetchWithRetry(path: string, init?: RequestInit) {
    const session = this.authSession ?? undefined
    let response = await this.fetchWithSession(path, init, session)

    if (isAuthRejected(response.status) && session) {
      try {
        this.authSession = await this.refreshAuth(session)
      } catch {
        throw new Error("Authentication expired. Re-authentication is required.")
      }
      response = await this.fetchWithSession(path, init, this.authSession)
    }

    if (!response.ok) {
      throw new Error(`Request failed (${response.status}) for ${path}`)
    }

    return response
  }

  private fetchWithSession(
    path: string,
    init: RequestInit | undefined,
    session?: AuthSession | null,
  ) {
    return this.fetchImpl(this.resolveUrl(path), {
      ...init,
      headers: this.withAuthHeaders(init?.headers, session),
    })
  }

  private resolveUrl(path: string) {
    if (!this.baseUrl) {
      throw new Error("Plugin is not configured. Call setup() first")
    }
    return `${this.baseUrl}${path}`
  }

  private withAuthHeaders(
    headers: RequestInit["headers"],
    session?: AuthSession | null,
  ): RequestInit["headers"] {
    const output = new Headers(headers)

    if (session?.cookie && !output.has("cookie")) {
      output.set("cookie", session.cookie)
    }

    if (session?.bearerToken && !output.has("authorization")) {
      output.set("authorization", `Bearer ${session.bearerToken}`)
    }

    return output
  }

  private sleep(ms: number) {
    return new Promise<void>((resolve) => {
      setTimeout(resolve, ms)
    })
  }
}

export function createGzctfPlugin(fetchImpl?: FetchLike) {
  return new GzctfPlugin(fetchImpl)
}
