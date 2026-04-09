import { randomBytes } from "node:crypto"
import { createWriteStream } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AgentTool } from "@mariozechner/pi-agent-core"
import { type Static, Type } from "@sinclair/typebox"
import { spawn } from "node:child_process"
import { truncateTail, type TruncationResult } from "../../utils/truncate.ts"

const bashSchema = Type.Object({
  command: Type.String({ description: "Command to execute" }),
  timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (default: 60)" })),
})

export type BashToolInput = Static<typeof bashSchema>

export interface BashToolDetails {
  ok: boolean
  exitCode: number | null
  failure?: {
    kind: "non_zero_exit" | "timeout" | "aborted" | "runtime_error"
    message: string
  }
  truncation?: TruncationResult
  fullOutputPath?: string
}

export interface BashOperations {
  exec: (
    command: string,
    cwd: string,
    options: {
      onData: (data: Buffer) => void
      signal?: AbortSignal
      timeout?: number
      env?: NodeJS.ProcessEnv
    },
  ) => Promise<{ exitCode: number | null; timedOut: boolean; aborted: boolean }>
}

export interface BashToolOptions {
  operations?: BashOperations
}

export interface ShellSpawnConfig {
  shell: string
  args: string[]
  options: {
    cwd: string
    env: NodeJS.ProcessEnv
    stdio: ["pipe", "pipe", "pipe"]
    windowsHide: boolean
  }
}

const isWindows = process.platform === "win32"

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === "string") {
    return error
  }

  try {
    return JSON.stringify(error)
  } catch {
    return "Unknown runtime error"
  }
}

export function createBashTool(
  cwd: string,
  options?: BashToolOptions,
): AgentTool<typeof bashSchema> {
  const ops = options?.operations ?? defaultBashOperations

  return {
    name: "shell",
    label: "shell",
    description: `Execute a ${isWindows ? "powershell" : "bash"} command.`,
    parameters: bashSchema,
    async execute(_toolCallId, params: BashToolInput, signal?: AbortSignal) {
      let output = ""
      let fullOutputPath: string | undefined
      let stream: ReturnType<typeof createWriteStream> | undefined

      const onData = (data: Buffer) => {
        const text = data.toString("utf-8")
        output += text

        if (output.length > 50_000 && !fullOutputPath) {
          fullOutputPath = join(tmpdir(), `misuzu-shell-${randomBytes(4).toString("hex")}.log`)
          stream = createWriteStream(fullOutputPath)
          stream.write(output)
        }
        stream?.write(text)
      }

      const timeoutMs = params.timeout ? params.timeout * 1000 : 60 * 1000
      let execution:
        | {
            exitCode: number | null
            timedOut: boolean
            aborted: boolean
          }
        | undefined
      let runtimeError: unknown

      try {
        execution = await ops.exec(params.command, cwd, {
          onData,
          signal,
          timeout: timeoutMs,
        })
      } catch (error) {
        runtimeError = error
      }

      stream?.end()

      const truncation = truncateTail(output)

      let text = truncation.content
      if (truncation.truncated) {
        const endLine = truncation.totalLines
        const startLine = endLine - truncation.outputLines + 1
        text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}]`
      }
      if (fullOutputPath) text += `\n\n[Full output saved to: ${fullOutputPath}]`

      let details: BashToolDetails
      if (runtimeError) {
        const message = formatUnknownError(runtimeError)
        details = {
          ok: false,
          exitCode: null,
          failure: { kind: "runtime_error", message },
          truncation,
          fullOutputPath,
        }
        text = [`[shell_failed kind=runtime_error] ${message}`, text].filter(Boolean).join("\n")
      } else {
        const exitCode = execution?.exitCode ?? null
        const timedOut = execution?.timedOut ?? false
        const aborted = execution?.aborted ?? false

        let failure: BashToolDetails["failure"]
        if (aborted) {
          failure = { kind: "aborted", message: "Command execution was aborted." }
        } else if (timedOut) {
          failure = {
            kind: "timeout",
            message: `Command timed out after ${timeoutMs}ms.`,
          }
        } else if (exitCode !== 0) {
          failure = {
            kind: "non_zero_exit",
            message: `Command exited with code ${String(exitCode)}.`,
          }
        }

        details = {
          ok: !failure,
          exitCode,
          failure,
          truncation,
          fullOutputPath,
        }

        if (failure) {
          text = [`[shell_failed kind=${failure.kind}] ${failure.message}`, text]
            .filter(Boolean)
            .join("\n")
        }
      }

      return {
        content: [{ type: "text", text }],
        details,
      }
    },
  }
}

export const defaultBashOperations: BashOperations = {
  exec(command, cwd, { onData, signal, timeout, env }) {
    return new Promise((resolve, reject) => {
      const config = buildShellSpawnConfig(cwd, command, env)

      const child = spawn(config.shell, config.args, config.options)

      child.stdout.on("data", onData)
      child.stderr.on("data", onData)

      let timeoutId: ReturnType<typeof setTimeout> | undefined
      let timedOut = false
      let aborted = false
      let settled = false

      const settle = (exitCode: number | null, timedOutVal: boolean, abortedVal: boolean) => {
        if (settled) return
        settled = true
        if (timeoutId) clearTimeout(timeoutId)
        signal?.removeEventListener("abort", onAbort)
        resolve({ exitCode, timedOut: timedOutVal, aborted: abortedVal })
      }

      const killProcess = (force: boolean) => {
        if (!child.pid) return
        const signalName = force ? "SIGKILL" : "SIGTERM"
        try {
          if (isWindows) {
            const killCmd = force
              ? `taskkill /PID ${child.pid} /T /F`
              : `taskkill /PID ${child.pid} /T`
            spawn("cmd.exe", ["/C", killCmd], { windowsHide: true })
          } else {
            try {
              process.kill(-child.pid, signalName)
            } catch {
              child.kill(signalName)
            }
          }
        } catch {
          try {
            child.kill(signalName)
          } catch {}
        }
      }

      if (timeout) {
        timeoutId = setTimeout(() => {
          timedOut = true
          killProcess(false)
          setTimeout(() => {
            if (!settled) killProcess(true)
          }, 500)
        }, timeout)
      }

      const onAbort = () => {
        aborted = true
        killProcess(true)
      }
      if (signal) {
        if (signal.aborted) {
          onAbort()
        }
        signal.addEventListener("abort", onAbort, { once: true })
      }

      child.on("close", (code) => {
        settle(code, timedOut, aborted)
      })

      child.on("error", (err) => {
        if (settled) return
        settled = true
        if (timeoutId) clearTimeout(timeoutId)
        signal?.removeEventListener("abort", onAbort)
        reject(err)
      })
    })
  },
}

export function buildShellSpawnConfig(
  cwd: string,
  command = "",
  env: NodeJS.ProcessEnv = {},
): ShellSpawnConfig {
  const shell = isWindows ? "pwsh.exe" : "/bin/bash"
  const args = isWindows
    ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command]
    : ["-c", command]

  return {
    shell,
    args,
    options: {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    },
  }
}
