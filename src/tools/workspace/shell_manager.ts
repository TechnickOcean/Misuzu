import * as Bun from "bun"
import { AppError } from "@/utils/errors"

const MAX_OUTPUT_CHARS = 2000
const MAX_BUFFER_LINES = 200

export type ShellEvent = {
  type: "terminal_output" | "terminal_exit"
  session_id: string
  stream?: "stdout" | "stderr"
  chunk?: string
  exitCode?: number | null
}

export class ShellSession {
  id: string
  name: string
  cwd: string
  env: Record<string, string>
  private basePath: string
  private onEvent?: (event: ShellEvent) => void
  private buffer: string[] = []

  private process: Bun.Subprocess | null = null
  private backgroundProcesses = new Set<Bun.Subprocess>()

  private currentResolver: ((output: string) => void) | null = null
  private currentRejecter: ((err: Error) => void) | null = null
  private cmdStdout = ""
  private cmdStderr = ""
  private cmdSentinel = ""
  private cmdTimer: Timer | null = null

  constructor(options: {
    id: string
    name: string
    cwd: string
    basePath: string
    onEvent?: (event: ShellEvent) => void
  }) {
    this.id = options.id
    this.name = options.name
    this.cwd = options.cwd
    this.basePath = options.basePath
    this.onEvent = options.onEvent
    this.env = {}
    this.start()
  }

  private start() {
    const isWin = process.platform === "win32"
    const shell = isWin ? "powershell.exe" : "bash"
    // PowerShell: -Command - means read from stdin
    const args = isWin ? ["-NoLogo", "-NoProfile", "-Command", "-"] : ["--noediting"]

    this.process = Bun.spawn({
      cmd: [shell, ...args],
      cwd: this.cwd,
      env: { ...process.env, ...this.env },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe"
    })

    const stdout = this.process.stdout as ReadableStream<Uint8Array>
    const stderr = this.process.stderr as ReadableStream<Uint8Array>

    this.pumpStream(stdout.getReader(), "stdout")
    this.pumpStream(stderr.getReader(), "stderr")

    this.process.exited.then((code) => {
      this.onEvent?.({ type: "terminal_exit", session_id: this.id, exitCode: code })
      this.process = null
      // If we were waiting for a command, it failed
      if (this.currentRejecter) {
        this.currentRejecter(new AppError("UPSTREAM_ERROR", "Shell process exited unexpectedly", { exitCode: code }))
        this.resetCmdState()
      }
    })
  }

  isRunning() {
    return Boolean(this.process)
  }

  async execute(command: string, background = false, timeout = 60000): Promise<string> {
    if (!this.isRunning()) this.start()

    if (background) return this.executeBackground(command)

    if (this.currentResolver) {
      throw new AppError("CONFLICT", "Session is busy executing another command", { session_id: this.id })
    }

    const isWin = process.platform === "win32"
    if (isWin) {
      const issues = validateWindowsCommand(command)
      if (issues.length) {
        throw new AppError("VALIDATION_ERROR", "PowerShell command likely invalid or blocking", {
          command,
          issues
        })
      }
      command = normalizeWindowsCommand(command)
    }
    const sentinelId = crypto.randomUUID().slice(0, 8)
    const sentinel = `__END_${sentinelId}__`
    this.cmdSentinel = sentinel
    this.cmdStdout = ""
    this.cmdStderr = ""

    // Command construction
    let fullCmd = ""
    if (isWin) {
      // PowerShell
      const prelude = WINDOWS_ALIAS_PRELUDE
      fullCmd = `${prelude}; ${command}; Write-Output "EXIT:$LASTEXITCODE"; Write-Output "CWD:$PWD"; Write-Output "${sentinel}"`
    } else {
      // Bash
      fullCmd = `${command}; echo "EXIT:$?"; echo "CWD:$(pwd)"; echo "${sentinel}"`
    }

    return new Promise((resolve, reject) => {
      this.currentResolver = resolve
      this.currentRejecter = reject
      const enc = new TextEncoder()

      // Write command
      const stdin = this.process!.stdin as {
        write: (chunk: Uint8Array) => void
        flush: () => void
      }
      stdin.write(enc.encode(`${fullCmd}\n`))
      stdin.flush()

      // Timeout
      this.cmdTimer = setTimeout(() => {
        if (this.currentRejecter) {
          this.currentRejecter(
            new AppError("UPSTREAM_ERROR", `Shell command timed out (${timeout}ms)`, { command, timeout })
          )
          this.resetCmdState()
          // Restart shell to clear stuck state
          this.stop()
          this.start()
        }
      }, timeout)
    })
  }

  private async executeBackground(command: string) {
    if (process.platform === "win32") {
      const issues = validateWindowsCommand(command)
      if (issues.length) {
        throw new AppError("VALIDATION_ERROR", "PowerShell command likely invalid or blocking", {
          command,
          issues
        })
      }
      command = normalizeWindowsCommand(command)
      command = `${WINDOWS_ALIAS_PRELUDE}; ${command}`
    }
    const subprocess = Bun.spawn({
      cmd: buildShellCommand(command),
      cwd: this.cwd,
      env: { ...process.env, ...this.env },
      stdout: "pipe",
      stderr: "pipe"
    })

    const stdout = subprocess.stdout as ReadableStream<Uint8Array>
    const stderr = subprocess.stderr as ReadableStream<Uint8Array>

    this.backgroundProcesses.add(subprocess)
    subprocess.exited.finally(() => {
      this.backgroundProcesses.delete(subprocess)
    })

    this.consumeBackgroundStream(stdout, "stdout")
    this.consumeBackgroundStream(stderr, "stderr")

    return `Background process started (pid: ${subprocess.pid})`
  }

  private consumeBackgroundStream(stream: ReadableStream | null, kind: "stdout" | "stderr") {
    if (!stream) return
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value)
        this.appendBuffer(kind, `[BG] ${text}`)
      }
    }
    pump().catch(() => {})
  }

  private async pumpStream(
    reader: import("node:stream/web").ReadableStreamDefaultReader<Uint8Array>,
    kind: "stdout" | "stderr"
  ) {
    const decoder = new TextDecoder()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value)
        this.handleOutput(kind, text)
      }
    } catch (_e) {}
  }

  private handleOutput(kind: "stdout" | "stderr", text: string) {
    this.appendBuffer(kind, text)
    this.onEvent?.({ type: "terminal_output", session_id: this.id, stream: kind, chunk: text })

    if (this.currentResolver) {
      if (kind === "stdout") this.cmdStdout += text
      else this.cmdStderr += text

      if (this.cmdStdout.includes(this.cmdSentinel)) {
        this.finalizeCommand()
      }
    }
  }

  private finalizeCommand() {
    if (this.cmdTimer) clearTimeout(this.cmdTimer)

    const resolve = this.currentResolver
    const reject = this.currentRejecter
    this.currentResolver = null
    this.currentRejecter = null
    this.cmdTimer = null

    const lines = this.cmdStdout.split(/\r?\n/)
    const sentinelIdx = lines.findIndex((l) => l.includes(this.cmdSentinel))

    // Safety check
    if (sentinelIdx === -1) return

    // Extract lines before sentinel
    const rawLines = lines.slice(0, sentinelIdx)

    let exitCode = 0
    let foundCwd = false
    let foundExit = false
    let cutIndex = rawLines.length

    // Scan backwards for CWD and EXIT
    for (let i = rawLines.length - 1; i >= 0; i--) {
      const line = (rawLines[i] ?? "").trim()
      if (line === "") continue

      if (!foundCwd && line.startsWith("CWD:")) {
        this.cwd = line.substring(4).trim()
        foundCwd = true
        cutIndex = i
        continue
      }
      if (foundCwd && !foundExit && line.startsWith("EXIT:")) {
        exitCode = parseInt(line.substring(5), 10) || 0
        foundExit = true
        cutIndex = i
        continue
      }

      // If we hit a non-empty line that isn't metadata while searching, stop.
      // Metadata must be the last non-empty lines.
      break
    }

    const output = formatOutput(rawLines.slice(0, cutIndex).join("\n"), this.cmdStderr)

    // Reset buffers
    this.cmdStdout = ""
    this.cmdStderr = ""
    if (reject && resolve)
      if (exitCode !== 0) {
        reject(new AppError("UPSTREAM_ERROR", `Command failed with exit code ${exitCode}`, { output, exitCode }))
      } else {
        resolve(output)
      }
  }

  private resetCmdState() {
    if (this.cmdTimer) clearTimeout(this.cmdTimer)
    this.currentResolver = null
    this.currentRejecter = null
    this.cmdTimer = null
    this.cmdStdout = ""
    this.cmdStderr = ""
  }

  private appendBuffer(kind: "stdout" | "stderr", text: string) {
    // Basic buffering, maybe filtering sentinel out would be nice but not strictly required
    const lines = text.split("\n")
    for (const line of lines) {
      if (!line) continue
      this.buffer.push(`${kind.toUpperCase()}: ${line}`)
      if (this.buffer.length > MAX_BUFFER_LINES) this.buffer.shift()
    }
  }

  readBuffer(lines = 40) {
    return this.buffer.slice(-lines).join("\n") || "(no output)"
  }

  stop() {
    this.process?.kill()
    this.process = null
    for (const proc of this.backgroundProcesses) {
      proc.kill()
    }
    this.backgroundProcesses.clear()
  }
}

export class ShellManager {
  private basePath: string
  private onEvent?: (event: ShellEvent) => void
  private sessions = new Map<string, ShellSession>()

  constructor(basePath: string, onEvent?: (event: ShellEvent) => void) {
    this.basePath = basePath
    this.onEvent = onEvent
  }

  createSession(name?: string) {
    const id = crypto.randomUUID()
    const session = new ShellSession({
      id,
      name: name || `terminal-${this.sessions.size + 1}`,
      cwd: this.basePath,
      basePath: this.basePath,
      onEvent: this.onEvent
    })
    this.sessions.set(id, session)
    return session
  }

  listSessions() {
    return [...this.sessions.values()]
  }

  getSession(id: string) {
    const session = this.sessions.get(id)
    if (!session) throw new AppError("NOT_FOUND", "Terminal session not found", { session_id: id })
    return session
  }

  killSession(id: string) {
    const session = this.getSession(id)
    session.stop()
    this.sessions.delete(id)
  }

  closeAll() {
    for (const session of this.sessions.values()) session.stop()
    this.sessions.clear()
  }
}

function buildShellCommand(command: string) {
  if (process.platform === "win32") return ["pwsh", "-NoProfile", "-Command", command]
  return ["bash", "-lc", command]
}

export const WINDOWS_ALIAS_PRELUDE = "Remove-Item -ErrorAction SilentlyContinue Alias:curl,Alias:wget"

export function normalizeWindowsCommand(command: string) {
  // Replace standard Unix tools with Windows equivalents or fixes
  let normalized = command
    .replace(/\bcurl(?!\.exe)\b/gi, "curl.exe")
    .replace(/\bwget(?!\.exe)\b/gi, "wget.exe")
    .replace(/\bls\s+-la\b/gi, "ls -Force")
    .replace(/\bls\s+-al\b/gi, "ls -Force")
    .replace(/\bgrep\s+-r\b/g, "Select-String -Recurse")
    .replace(/\bgrep\b/g, "Select-String")
    .replace(/\brm\s+-rf\b/g, "rm -Recurse -Force")
    .replace(/\bunzip\s+([^\s]+)/g, "Expand-Archive -Path $1 -DestinationPath . -Force")
    .replace(/\btouch\s+([^\s]+)/g, "New-Item -ItemType File -Force -Path $1")
    .replace(/\bexport\s+([A-Za-z0-9_]+)=(["'])(.*?)\2/g, "$env:$1=$2$3$2")
    .replace(/\bexport\s+([A-Za-z0-9_]+)=([^\s;]+)/g, "$env:$1='$2'")

  // Handle && chaining by converting to nested if ($?) { ... } blocks
  // Example: "cmd1 && cmd2" -> "cmd1; if ($?) { cmd2 }"
  if (normalized.includes("&&")) {
    const parts = normalized.split("&&").map((p) => p.trim())
    if (parts.length > 1) {
      const base = parts[0]
      const rest = parts.slice(1)
      const suffix = " }".repeat(rest.length)
      const middle = rest.map((p) => `; if ($?) { ${p}`).join("")
      normalized = base + middle + suffix
    }
  }

  return normalized
}

export function validateWindowsCommand(command: string) {
  const issues: string[] = []
  // && is now handled in normalizeWindowsCommand

  if (/\s&\s*$/.test(command) || /&\s*$/.test(command)) {
    issues.push("Do not use '&' for background. Use the tool's background=true option.")
  }
  return issues
}

function formatOutput(stdout: string, stderr: string) {
  let out = stdout.trim()
  let err = stderr.trim()
  if (out.length > MAX_OUTPUT_CHARS) {
    out = `${out.slice(0, MAX_OUTPUT_CHARS)}\n... (stdout truncated)`
  }
  if (err.length > MAX_OUTPUT_CHARS) {
    err = `${err.slice(0, MAX_OUTPUT_CHARS)}\n... (stderr truncated)`
  }

  const parts = []
  if (out) parts.push(`STDOUT:\n${out}`)
  if (err) parts.push(`STDERR:\n${err}`)
  return parts.join("\n") || "(no output)"
}
