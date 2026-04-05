export interface OpenHeadedAuthInput {
  loginUrl: string
  authCheckUrl: string
  timeoutSec?: number
  pollIntervalMs?: number
  successStreak?: number
  requiredCookieNames?: string[]
  browserChannel?: "chrome" | "msedge"
  cliBin?: string
  userDataDir?: string
  keepProfileDir?: boolean
}
export interface OpenHeadedAuthResult {
  cookieHeader: string
  cookies: Array<{
    name: string
    value: string
    domain: string
    path: string
    expires: number
    secure: boolean
    httpOnly: boolean
    sameSite: string
  }>
  authenticatedAt: number
  loginUrl: string
  authCheckUrl: string
  userDataDir: string
}
export declare function openHeadedAuth(input: OpenHeadedAuthInput): Promise<OpenHeadedAuthResult>
