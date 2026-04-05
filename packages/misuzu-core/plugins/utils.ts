import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { spawn } from "node:child_process"

interface StoredCookie {
  name: string
  value: string
  domain: string
  path: string
  expires: number
  secure: boolean
  httpOnly: boolean
  sameSite: string
}

interface StorageState {
  cookies: StoredCookie[]
}

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

export async function openHeadedAuth(input: OpenHeadedAuthInput): Promise<OpenHeadedAuthResult> {
  const timeoutSec = input.timeoutSec ?? 300
  const pollIntervalMs = input.pollIntervalMs ?? 3000
  const successStreak = Math.max(1, input.successStreak ?? 2)
  const requiredCookieNames = new Set((input.requiredCookieNames ?? []).map((name) => name.trim()))
  const keepProfileDir = input.keepProfileDir ?? false

  const createdDir = input.userDataDir
    ? undefined
    : await mkdtemp(join(tmpdir(), "misuzu-plugin-auth-"))
  const userDataDir = input.userDataDir ?? createdDir

  if (!userDataDir) {
    throw new Error("Failed to allocate browser profile directory")
  }

  const sessionName = `misuzu-auth-${randomUUID().slice(0, 8)}`
  const stateFile = join(userDataDir, `${sessionName}-state.json`)

  try {
    await runPlaywrightCli(
      [
        `-s=${sessionName}`,
        "open",
        "--headed",
        "--persistent",
        "--profile",
        userDataDir,
        "--browser",
        input.browserChannel ?? "chrome",
        input.loginUrl,
      ],
      120_000,
      input.cliBin,
    )

    const deadline = Date.now() + timeoutSec * 1000
    let successCount = 0

    while (Date.now() < deadline) {
      await runPlaywrightCli([`-s=${sessionName}`, "state-save", stateFile], 60_000, input.cliBin)

      const storage = await readStorageState(stateFile)
      const cookieHeader = storage.cookies
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join("; ")

      if (!cookieHeader) {
        successCount = 0
        await sleep(pollIntervalMs)
        continue
      }

      if (requiredCookieNames.size > 0) {
        const cookieNames = new Set(storage.cookies.map((cookie) => cookie.name))
        const hasAllRequiredCookies = [...requiredCookieNames].every((name) =>
          cookieNames.has(name),
        )
        if (!hasAllRequiredCookies) {
          successCount = 0
          await sleep(pollIntervalMs)
          continue
        }
      }

      const authOk = await checkAuthWithCookieHeader(input.authCheckUrl, cookieHeader)
      if (!authOk) {
        successCount = 0
        await sleep(pollIntervalMs)
        continue
      }

      successCount += 1
      if (successCount < successStreak) {
        await sleep(pollIntervalMs)
        continue
      }

      return {
        cookieHeader,
        cookies: storage.cookies,
        authenticatedAt: Date.now(),
        loginUrl: input.loginUrl,
        authCheckUrl: input.authCheckUrl,
        userDataDir,
      }
    }

    throw new Error(`Timed out after ${timeoutSec}s waiting for authenticated session`)
  } finally {
    await runPlaywrightCli([`-s=${sessionName}`, "close"], 20_000, input.cliBin).catch(() => {})

    if (createdDir && !keepProfileDir) {
      await rm(createdDir, { recursive: true, force: true })
    }
  }
}

async function readStorageState(path: string): Promise<StorageState> {
  const text = await readFile(path, "utf-8")
  return JSON.parse(text) as StorageState
}

async function checkAuthWithCookieHeader(authCheckUrl: string, cookieHeader: string) {
  try {
    const response = await fetch(authCheckUrl, {
      headers: {
        cookie: cookieHeader,
      },
      redirect: "manual",
    })

    return response.status >= 200 && response.status < 300
  } catch {
    return false
  }
}

async function runPlaywrightCli(args: string[], timeoutMs: number, cliBin?: string) {
  const invocations = resolvePlaywrightCliInvocations(cliBin)
  const errors: string[] = []

  for (const invocation of invocations) {
    try {
      await runProcess(invocation.command, [...invocation.prefixArgs, ...args], timeoutMs)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      const message = error instanceof Error ? error.message : String(error)
      errors.push(`${invocation.command}: ${message}`)

      if (code !== "ENOENT" && code !== "EINVAL") {
        throw error
      }
    }
  }

  throw new Error(
    [
      "Unable to locate playwright-cli executable.",
      "Install playwright-cli globally, or set MISUZU_PLAYWRIGHT_CLI_BIN / input.cliBin to the executable path.",
      `Tried: ${invocations.map((item) => item.command).join(", ")}`,
      ...errors,
    ].join("\n"),
  )
}

async function runProcess(command: string, args: string[], timeoutMs: number) {
  await new Promise<void>((resolve, reject) => {
    const useShell = shouldUseShell(command)
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: useShell,
    })

    let output = ""
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error(`${command} timed out: ${args.join(" ")}`))
    }, timeoutMs)

    child.stdout.on("data", (chunk) => {
      output += chunk.toString("utf-8")
    })

    child.stderr.on("data", (chunk) => {
      output += chunk.toString("utf-8")
    })

    child.on("error", (error) => {
      clearTimeout(timeout)
      reject(error)
    })

    child.on("close", (code) => {
      clearTimeout(timeout)
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`${command} exited with code ${String(code)}: ${args.join(" ")}\n${output}`))
    })
  })
}

function resolvePlaywrightCliInvocations(cliBin?: string) {
  const explicitBin = normalizeExplicitBin(
    cliBin?.trim() || process.env.MISUZU_PLAYWRIGHT_CLI_BIN?.trim(),
  )
  if (explicitBin) {
    return [{ command: explicitBin, prefixArgs: [] }]
  }

  const isWindows = process.platform === "win32"
  const npx = isWindows ? "npx.cmd" : "npx"
  const pnpm = isWindows ? "pnpm.cmd" : "pnpm"

  return [
    { command: isWindows ? "playwright-cli.cmd" : "playwright-cli", prefixArgs: [] },
    ...(isWindows ? [{ command: "playwright-cli.exe", prefixArgs: [] }] : []),
    { command: "playwright-cli", prefixArgs: [] },
    { command: npx, prefixArgs: ["playwright-cli"] },
    { command: pnpm, prefixArgs: ["exec", "playwright-cli"] },
  ]
}

function normalizeExplicitBin(bin: string | undefined) {
  if (!bin) {
    return undefined
  }

  const trimmed = bin.trim()
  if (trimmed.length === 0) {
    return undefined
  }

  const quotedWithDouble = trimmed.startsWith('"') && trimmed.endsWith('"')
  const quotedWithSingle = trimmed.startsWith("'") && trimmed.endsWith("'")
  if (quotedWithDouble || quotedWithSingle) {
    return trimmed.slice(1, -1)
  }

  return trimmed
}

function shouldUseShell(command: string) {
  if (process.platform !== "win32") {
    return false
  }

  const normalized = command.toLowerCase()
  return normalized.endsWith(".cmd") || normalized.endsWith(".bat")
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}
