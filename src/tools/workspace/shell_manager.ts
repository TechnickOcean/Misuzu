import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
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
  private pendingLine = ""
  private process: Bun.Subprocess | null = null

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
  }

  isRunning() {
    return Boolean(this.process)
  }

  async execute(command: string, background = false) {
    const trimmed = command.trim()
    const cdMatch = /^cd(\s+(.+))?$/i.exec(trimmed)
    if (cdMatch) {
      const rawTarget = cdMatch[2]?.trim()
      const target = rawTarget ? this.resolvePath(rawTarget) : this.basePath
      await this.assertDirExists(target)
      this.cwd = target
      return `Changed directory to ${this.cwd}`
    }

    if (this.process && this.isRunning()) {
      throw new AppError("CONFLICT", "Session already has a running process", { session_id: this.id })
    }

    const subprocess = Bun.spawn({
      cmd: buildShellCommand(command),
      cwd: this.cwd,
      env: { ...process.env, ...this.env },
      stdout: "pipe",
      stderr: "pipe"
    })

    if (background) {
      this.process = subprocess
      this.streamToBuffer(subprocess.stdout, "stdout")
      this.streamToBuffer(subprocess.stderr, "stderr")
      subprocess.exited.then((exitCode) => {
        this.process = null
        this.onEvent?.({ type: "terminal_exit", session_id: this.id, exitCode })
      })
      return `Background process started (pid: ${subprocess.pid})`
    }

    const [stdout, stderr, exitCode] = await Promise.all([
      subprocess.stdout ? new Response(subprocess.stdout).text() : Promise.resolve(""),
      subprocess.stderr ? new Response(subprocess.stderr).text() : Promise.resolve(""),
      subprocess.exited
    ])

    if (stdout) this.appendOutput("stdout", stdout)
    if (stderr) this.appendOutput("stderr", stderr)

    if (exitCode !== 0) {
      throw new AppError("UPSTREAM_ERROR", "Shell command failed", {
        command,
        exitCode
      })
    }

    return formatOutput(stdout, stderr)
  }

  readBuffer(lines = 40) {
    const slice = this.buffer.slice(-lines)
    return slice.join("\n") || "(no output)"
  }

  stop() {
    if (this.process) {
      this.process.kill()
      this.process = null
    }
  }

  private async assertDirExists(target: string) {
    try {
      const stat = await fs.stat(target)
      if (!stat.isDirectory()) {
        throw new AppError("VALIDATION_ERROR", "Target is not a directory", { target })
      }
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError("NOT_FOUND", "Directory does not exist", { target })
    }
  }

  private resolvePath(target: string) {
    if (target.startsWith("~")) {
      const home = os.homedir()
      const rest = target.slice(1)
      return path.resolve(home, rest)
    }
    if (path.isAbsolute(target)) return target
    return path.resolve(this.cwd, target)
  }

  private streamToBuffer(stream: ReadableStream<Uint8Array> | null, kind: "stdout" | "stderr") {
    if (!stream) return
    const reader = stream.getReader()
    const decoder = new TextDecoder()

    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        this.appendOutput(kind, chunk)
        this.onEvent?.({ type: "terminal_output", session_id: this.id, stream: kind, chunk })
      }
    }

    pump().catch(() => {})
  }

  private appendOutput(kind: "stdout" | "stderr", chunk: string) {
    const tagged = `${kind.toUpperCase()}: ${chunk}`
    const combined = this.pendingLine + tagged
    const lines = combined.split("\n")
    this.pendingLine = lines.pop() ?? ""
    for (const line of lines) {
      if (!line) continue
      this.buffer.push(line)
      if (this.buffer.length > MAX_BUFFER_LINES) this.buffer.shift()
    }
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

function formatOutput(stdout: string, stderr: string) {
  let out = stdout
  let err = stderr
  if (out.length > MAX_OUTPUT_CHARS) {
    out = `${out.slice(0, MAX_OUTPUT_CHARS)}\n... (stdout truncated)`
  }
  if (err.length > MAX_OUTPUT_CHARS) {
    err = `${err.slice(0, MAX_OUTPUT_CHARS)}\n... (stderr truncated)`
  }
  return `STDOUT:\n${out}\nSTDERR:\n${err}`
}
