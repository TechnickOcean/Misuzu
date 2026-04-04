import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type BrowserContext, type Cookie, chromium } from "playwright"

export interface OpenHeadedAuthInput {
  loginUrl: string
  authCheckUrl: string
  timeoutSec?: number
  pollIntervalMs?: number
  browserChannel?: "chrome" | "msedge"
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

export async function openHeadedAuth(input: OpenHeadedAuthInput): Promise<OpenHeadedAuthResult> {
  const timeoutSec = input.timeoutSec ?? 300
  const pollIntervalMs = input.pollIntervalMs ?? 2000
  const keepProfileDir = input.keepProfileDir ?? false

  const createdDir = input.userDataDir
    ? undefined
    : await mkdtemp(join(tmpdir(), "misuzu-plugin-auth-"))
  const userDataDir = input.userDataDir ?? createdDir

  if (!userDataDir) {
    throw new Error("Failed to allocate browser profile directory")
  }

  let context: BrowserContext | undefined
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      channel: input.browserChannel ?? "chrome",
    })

    const page = context.pages()[0] ?? (await context.newPage())
    await page.goto(input.loginUrl, { waitUntil: "domcontentloaded" })
    await page.bringToFront()

    const deadline = Date.now() + timeoutSec * 1000
    while (Date.now() < deadline) {
      const authenticated = await page.evaluate(async (authCheckUrl: string) => {
        try {
          const response = await fetch(authCheckUrl, { credentials: "include" })
          return response.status >= 200 && response.status < 300
        } catch {
          return false
        }
      }, input.authCheckUrl)

      if (authenticated) {
        const cookies: Cookie[] = await context.cookies()
        const cookieHeader = cookies
          .map((cookie: Cookie) => `${cookie.name}=${cookie.value}`)
          .join("; ")

        if (!cookieHeader) {
          throw new Error("Auth check succeeded but no cookies were captured")
        }

        return {
          cookieHeader,
          cookies: cookies.map((cookie: Cookie) => ({
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain,
            path: cookie.path,
            expires: cookie.expires,
            secure: cookie.secure,
            httpOnly: cookie.httpOnly,
            sameSite: cookie.sameSite,
          })),
          authenticatedAt: Date.now(),
          loginUrl: input.loginUrl,
          authCheckUrl: input.authCheckUrl,
          userDataDir,
        }
      }

      await sleep(pollIntervalMs)
    }

    throw new Error(`Timed out after ${timeoutSec}s waiting for authenticated session`)
  } finally {
    if (context) {
      await context.close()
    }

    if (createdDir && !keepProfileDir) {
      await rm(createdDir, { recursive: true, force: true })
    }
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}
