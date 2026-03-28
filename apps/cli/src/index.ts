#!/usr/bin/env tsx
import { randomBytes } from "node:crypto"
import { createInterface } from "node:readline/promises"
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  CombinedAutocompleteProvider,
  Editor,
  type EditorTheme,
  Key,
  ProcessTerminal,
  Text,
  TUI,
  matchesKey,
  type SelectListTheme,
} from "@mariozechner/pi-tui"
import "dotenv/config"

type RuntimeJsonValue =
  | string
  | number
  | boolean
  | null
  | RuntimeJsonValue[]
  | { [key: string]: RuntimeJsonValue }

type RuntimeEventSource = "server" | "coordinator" | "solver"
type RuntimeConnectionState = "connecting" | "connected" | "reconnecting" | "error"

interface RuntimeEventEnvelope<TPayload extends RuntimeJsonValue = RuntimeJsonValue> {
  seq: number
  ts: string
  source: RuntimeEventSource
  type: string
  payload: TPayload
}

interface ModelPoolSlotSnapshot {
  model: string
  status: "idle" | "busy"
  solverId?: string
}

interface SolverSnapshot {
  solverId: string
  challengeName?: string
  status: "assigned" | "solving" | "solved" | "failed" | "stopped"
  model?: string
  messageCount: number
  isStreaming: boolean
  updatedAt?: string
}

interface RuntimeSnapshot {
  protocolVersion: number
  workspaceId?: string
  workspaceRoot: string
  modelPool: {
    slots: ModelPoolSlotSnapshot[]
    available: number
    total: number
  }
  challengeQueue: Array<{
    challengeId: string
    challengeName: string
    category: string
    difficulty?: number
  }>
  solvers: SolverSnapshot[]
  generatedAt: string
  lastSeq: number
}

interface CoordinatorPromptPayload {
  message: string
}

interface SolverSteerPayload {
  solverId: string
  message: string
}

interface SolverAbortPayload {
  solverId: string
}

interface SolverContinuePayload {
  solverId: string
}

interface AddModelToPoolPayload {
  modelId: string
  concurrency?: number
}

interface SetModelConcurrencyPayload {
  modelId: string
  concurrency: number
}

interface ServerRestartPayload {
  graceful?: boolean
}

interface RuntimeCommandPayloadMap {
  coordinator_prompt: CoordinatorPromptPayload
  solver_steer: SolverSteerPayload
  solver_abort: SolverAbortPayload
  solver_continue: SolverContinuePayload
  add_model_to_pool: AddModelToPoolPayload
  set_model_concurrency: SetModelConcurrencyPayload
  server_restart: ServerRestartPayload
}

type RuntimeCommandName = keyof RuntimeCommandPayloadMap

type RuntimeCommandRequestFor<TCommand extends RuntimeCommandName> = {
  command: TCommand
  payload: RuntimeCommandPayloadMap[TCommand]
  requestId?: string
}

type RuntimeCommandResponse = {
  ok: boolean
  requestId?: string
  payload?: RuntimeJsonValue
  error?: string
}

interface CliOptions {
  serverUrl: string
  token?: string
  tokenFile?: string
  reconnectDelayMs: number
  maxEvents: number
}

interface ParsedServerEndpoint {
  host: string
  port: number
}

interface DaemonLaunchResult {
  ok: boolean
  detail: string
}

interface UiState {
  connection: RuntimeConnectionState
  snapshot?: RuntimeSnapshot
  selectedSolverId?: string
  events: RuntimeEventEnvelope[]
  statusLine: string
  commandPending: boolean
}

const ANSI = {
  reset: "\x1b[0m",
  gray: "\x1b[90m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
}

const cliEntryPath = fileURLToPath(import.meta.url)
const cliPackageDir = resolve(dirname(cliEntryPath), "..")
const inferredServerMainPath = resolve(
  cliPackageDir,
  "..",
  "..",
  "packages",
  "misuzu-server",
  "src",
  "main.ts",
)

const SELECT_LIST_THEME: SelectListTheme = {
  selectedPrefix: (value) => `${ANSI.cyan}${value}${ANSI.reset}`,
  selectedText: (value) => `${ANSI.bold}${value}${ANSI.reset}`,
  description: (value) => `${ANSI.gray}${value}${ANSI.reset}`,
  scrollInfo: (value) => `${ANSI.gray}${value}${ANSI.reset}`,
  noMatch: (value) => `${ANSI.yellow}${value}${ANSI.reset}`,
}

const EDITOR_THEME: EditorTheme = {
  borderColor: (value) => `${ANSI.gray}${value}${ANSI.reset}`,
  selectList: SELECT_LIST_THEME,
}

class MisuzuServerClient {
  constructor(
    private readonly serverUrl: string,
    private readonly token?: string,
  ) {}

  async getSnapshot(signal?: AbortSignal): Promise<RuntimeSnapshot> {
    const response = await fetch(`${this.serverUrl}/runtime/snapshot`, {
      method: "GET",
      headers: this.buildHeaders(),
      signal,
    })

    if (!response.ok) {
      throw new Error(`snapshot request failed with HTTP ${response.status}`)
    }

    const parsed = (await response.json()) as RuntimeSnapshot
    return parsed
  }

  async sendCommand<TCommand extends RuntimeCommandName>(
    request: RuntimeCommandRequestFor<TCommand>,
    signal?: AbortSignal,
  ): Promise<RuntimeCommandResponse> {
    const response = await fetch(`${this.serverUrl}/runtime/command`, {
      method: "POST",
      headers: {
        ...this.buildHeaders(),
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
      signal,
    })

    const parsed = (await response.json()) as RuntimeCommandResponse
    if (!response.ok && !parsed.ok) {
      return parsed
    }
    return parsed
  }

  async streamEvents(options: {
    afterSeq: number
    signal: AbortSignal
    onOpen: () => void
    onEvent: (event: RuntimeEventEnvelope) => void
  }): Promise<void> {
    const response = await fetch(`${this.serverUrl}/runtime/events?after=${options.afterSeq}`, {
      method: "GET",
      headers: {
        ...this.buildHeaders(),
        accept: "text/event-stream",
        "cache-control": "no-cache",
      },
      signal: options.signal,
    })

    if (!response.ok) {
      throw new Error(`event stream failed with HTTP ${response.status}`)
    }

    if (!response.body) {
      throw new Error("event stream missing response body")
    }

    options.onOpen()
    await readSseStream(response.body, options.signal, (record) => {
      if (record.event === "heartbeat") {
        return
      }

      const parsed = parseRuntimeEventEnvelope(record.data)
      if (!parsed) {
        return
      }

      options.onEvent(parsed)
    })
  }

  private buildHeaders(): Record<string, string> {
    if (!this.token) return {}
    return {
      "x-misuzu-token": this.token,
      authorization: `Bearer ${this.token}`,
    }
  }
}

class MisuzuCliApp {
  private readonly terminal = new ProcessTerminal()
  private readonly tui = new TUI(this.terminal)
  private readonly dashboardText = new Text("", 0, 0)
  private readonly statusText = new Text("", 0, 0)
  private readonly helpText = new Text("", 0, 0)
  private readonly editor = new Editor(this.tui, EDITOR_THEME, { paddingX: 1 })

  private readonly state: UiState = {
    connection: "connecting",
    events: [],
    statusLine: "Booting...",
    commandPending: false,
  }

  private readonly client: MisuzuServerClient
  private readonly options: CliOptions
  private stopped = false
  private reconnectTimer?: NodeJS.Timeout
  private streamAbort?: AbortController
  private refreshTimer?: NodeJS.Timeout
  private refreshInFlight = false
  private lastSeq = 0

  constructor(options: CliOptions) {
    this.options = options
    this.client = new MisuzuServerClient(options.serverUrl, options.token)

    this.editor.setAutocompleteProvider(
      new CombinedAutocompleteProvider(
        [
          { name: "help", description: "Show command guide" },
          { name: "refresh", description: "Refresh runtime snapshot" },
          { name: "select", description: "Select solver by id or next/prev" },
          { name: "steer", description: "Send hint to selected solver" },
          { name: "abort", description: "Abort selected solver" },
          { name: "continue", description: "Continue selected solver" },
          { name: "models", description: "Manage model pool and concurrency" },
          { name: "server", description: "Server operations (restart)" },
          { name: "prompt", description: "Send prompt to coordinator" },
          { name: "clear-events", description: "Clear local event panel" },
          { name: "quit", description: "Quit TUI" },
        ],
        process.cwd(),
      ),
    )
  }

  async start() {
    this.editor.onSubmit = (input) => {
      void this.handleUserInput(input)
    }

    this.helpText.setText(this.renderHelpText())
    this.tui.addChild(this.dashboardText)
    this.tui.addChild(this.statusText)
    this.tui.addChild(this.helpText)
    this.tui.addChild(this.editor)
    this.tui.setFocus(this.editor)

    this.tui.addInputListener((data) => {
      if (matchesKey(data, Key.ctrl("c"))) {
        this.stop(0)
        return { consume: true }
      }

      if (matchesKey(data, Key.ctrl("r"))) {
        void this.refreshSnapshot("manual refresh")
        return { consume: true }
      }

      if (matchesKey(data, Key.alt("j"))) {
        this.selectAdjacentSolver(1)
        return { consume: true }
      }

      if (matchesKey(data, Key.alt("k"))) {
        this.selectAdjacentSolver(-1)
        return { consume: true }
      }

      return undefined
    })

    this.tui.start()
    this.render()

    await this.refreshSnapshot("initial snapshot")
    void this.runEventLoop()
  }

  private async handleUserInput(input: string) {
    const trimmed = input.trim()
    if (trimmed.length === 0) return

    if (this.state.commandPending) {
      this.setStatus("A command is still pending. Please wait.", "yellow")
      return
    }

    this.state.commandPending = true
    this.editor.disableSubmit = true
    this.render()

    try {
      if (trimmed.startsWith("/")) {
        await this.runSlashCommand(trimmed.slice(1).trim())
      } else {
        await this.sendCoordinatorPrompt(trimmed)
      }
    } finally {
      this.state.commandPending = false
      this.editor.disableSubmit = false
      this.render()
    }
  }

  private async runSlashCommand(body: string) {
    const spaceIndex = body.indexOf(" ")
    const command = (spaceIndex === -1 ? body : body.slice(0, spaceIndex)).toLowerCase()
    const rest = spaceIndex === -1 ? "" : body.slice(spaceIndex + 1).trim()

    switch (command) {
      case "":
      case "help":
        this.setStatus(
          "Commands: /help /refresh /select /steer /abort /continue /models /server restart /prompt /clear-events /quit",
        )
        return

      case "quit":
      case "q":
        this.stop(0)
        return

      case "refresh":
        await this.refreshSnapshot("manual refresh")
        return

      case "clear-events":
        this.state.events = []
        this.setStatus("Cleared local event panel.")
        return

      case "select":
        this.handleSelectCommand(rest)
        return

      case "prompt":
        if (rest.length === 0) {
          this.setStatus("Usage: /prompt <message>", "yellow")
          return
        }
        await this.sendCoordinatorPrompt(rest)
        return

      case "steer":
        await this.handleSteerCommand(rest)
        return

      case "abort":
        await this.handleSolverControlCommand("solver_abort", rest)
        return

      case "continue":
        await this.handleSolverControlCommand("solver_continue", rest)
        return

      case "models":
      case "model":
        await this.handleModelsCommand(rest)
        return

      case "server":
        await this.handleServerCommand(rest)
        return

      case "restart-server":
        await this.handleServerCommand("restart")
        return

      default:
        this.setStatus(`Unknown command: /${command}`, "yellow")
        return
    }
  }

  private handleSelectCommand(argument: string) {
    if (!this.state.snapshot) {
      this.setStatus("Snapshot unavailable.", "yellow")
      return
    }

    const value = argument.trim()
    if (value === "next") {
      this.selectAdjacentSolver(1)
      return
    }

    if (value === "prev") {
      this.selectAdjacentSolver(-1)
      return
    }

    if (value.length === 0) {
      this.setStatus("Usage: /select <solver-id|next|prev>", "yellow")
      return
    }

    const solver = this.state.snapshot.solvers.find((item) => item.solverId === value)
    if (!solver) {
      this.setStatus(`Solver not found: ${value}`, "yellow")
      return
    }

    this.state.selectedSolverId = solver.solverId
    this.setStatus(`Selected solver ${solver.solverId}.`)
  }

  private selectAdjacentSolver(direction: 1 | -1) {
    const solvers = this.state.snapshot?.solvers ?? []
    if (solvers.length === 0) {
      this.setStatus("No active solvers.", "yellow")
      return
    }

    const currentIndex = solvers.findIndex(
      (solver) => solver.solverId === this.state.selectedSolverId,
    )
    const baseIndex = currentIndex === -1 ? 0 : currentIndex
    const nextIndex = (baseIndex + direction + solvers.length) % solvers.length
    this.state.selectedSolverId = solvers[nextIndex]?.solverId
    this.setStatus(`Selected solver ${this.state.selectedSolverId}.`)
  }

  private async sendCoordinatorPrompt(message: string) {
    const response = await this.client.sendCommand({
      command: "coordinator_prompt",
      payload: { message },
    })

    if (!response.ok) {
      this.setStatus(`Prompt rejected: ${response.error ?? "request failed"}`, "red")
      return
    }

    this.setStatus("Prompt accepted by coordinator.", "green")
    this.scheduleSnapshotRefresh()
  }

  private async handleSteerCommand(argument: string) {
    const value = argument.trim()
    if (value.length === 0) {
      this.setStatus("Usage: /steer [solver-id] <message>", "yellow")
      return
    }

    const splitIndex = value.indexOf(" ")
    if (splitIndex === -1) {
      const solverId = this.state.selectedSolverId
      if (!solverId) {
        this.setStatus("No solver selected. Use /select <solver-id> first.", "yellow")
        return
      }

      const response = await this.client.sendCommand({
        command: "solver_steer",
        payload: { solverId, message: value },
      })
      this.handleCommandResponse(response, `Steer sent to ${solverId}.`)
      return
    }

    const firstToken = value.slice(0, splitIndex).trim()
    const remainder = value.slice(splitIndex + 1).trim()
    const solverId = this.resolveSolverId(firstToken) ?? this.state.selectedSolverId
    const message = solverId === firstToken ? remainder : value

    if (!solverId || message.length === 0) {
      this.setStatus("Usage: /steer [solver-id] <message>", "yellow")
      return
    }

    const response = await this.client.sendCommand({
      command: "solver_steer",
      payload: { solverId, message },
    })
    this.handleCommandResponse(response, `Steer sent to ${solverId}.`)
  }

  private async handleSolverControlCommand(
    command: "solver_abort" | "solver_continue",
    argument: string,
  ) {
    const solverId = this.resolveSolverId(argument.trim()) ?? this.state.selectedSolverId
    if (!solverId) {
      this.setStatus(
        `No solver selected. Use /${command === "solver_abort" ? "abort" : "continue"} <solver-id>.`,
        "yellow",
      )
      return
    }

    const response =
      command === "solver_abort"
        ? await this.client.sendCommand({
            command,
            payload: { solverId },
          })
        : await this.client.sendCommand({
            command,
            payload: { solverId },
          })

    const successMessage =
      command === "solver_abort" ? `Abort sent to ${solverId}.` : `Continue sent to ${solverId}.`
    this.handleCommandResponse(response, successMessage)
  }

  private async handleModelsCommand(argument: string) {
    const parts = argument.split(/\s+/).filter((item) => item.length > 0)
    if (parts.length === 0) {
      this.setStatus(
        "Usage: /models add <model-id> [concurrency] | /models concurrency <model-id> <count>",
        "yellow",
      )
      return
    }

    const action = parts[0]?.toLowerCase()
    if (action === "add") {
      const modelId = parts[1]
      const concurrency = parts[2] ? Number.parseInt(parts[2], 10) : 1

      if (!modelId) {
        this.setStatus("Usage: /models add <model-id> [concurrency]", "yellow")
        return
      }

      if (!Number.isFinite(concurrency) || concurrency < 1) {
        this.setStatus("Concurrency must be a positive integer.", "yellow")
        return
      }

      const response = await this.client.sendCommand({
        command: "add_model_to_pool",
        payload: { modelId, concurrency },
      })
      this.handleCommandResponse(
        response,
        `Model ${modelId} added to pool with +${concurrency} slot(s).`,
      )
      return
    }

    if (action === "concurrency") {
      const modelId = parts[1]
      const concurrency = parts[2] ? Number.parseInt(parts[2], 10) : Number.NaN

      if (!modelId || !Number.isFinite(concurrency) || concurrency < 1) {
        this.setStatus("Usage: /models concurrency <model-id> <count>", "yellow")
        return
      }

      const response = await this.client.sendCommand({
        command: "set_model_concurrency",
        payload: { modelId, concurrency },
      })
      this.handleCommandResponse(response, `Model ${modelId} concurrency set to ${concurrency}.`)
      return
    }

    this.setStatus(
      "Usage: /models add <model-id> [concurrency] | /models concurrency <model-id> <count>",
      "yellow",
    )
  }

  private async handleServerCommand(argument: string) {
    const action = argument.trim().toLowerCase()
    if (action !== "restart") {
      this.setStatus("Usage: /server restart", "yellow")
      return
    }

    const response = await this.client.sendCommand({
      command: "server_restart",
      payload: { graceful: true },
    })

    if (!response.ok) {
      this.setStatus(`Server restart failed: ${response.error ?? "request failed"}`, "red")
      return
    }

    this.setStatus("Server restart requested. Reconnecting...", "yellow")
    this.state.connection = "reconnecting"
    this.render()
  }

  private handleCommandResponse(response: RuntimeCommandResponse, successMessage: string) {
    if (!response.ok) {
      this.setStatus(`Command failed: ${response.error ?? "request failed"}`, "red")
      return
    }

    this.setStatus(successMessage, "green")
    this.scheduleSnapshotRefresh()
  }

  private resolveSolverId(value: string): string | undefined {
    if (!this.state.snapshot) return undefined
    if (value.length === 0) return undefined
    return this.state.snapshot.solvers.find((solver) => solver.solverId === value)?.solverId
  }

  private async runEventLoop() {
    while (!this.stopped) {
      this.state.connection = this.state.snapshot ? "reconnecting" : "connecting"
      this.render()

      const abortController = new AbortController()
      this.streamAbort = abortController

      try {
        await this.client.streamEvents({
          afterSeq: this.lastSeq,
          signal: abortController.signal,
          onOpen: () => {
            this.state.connection = "connected"
            this.setStatus("Connected to event stream.", "green")
          },
          onEvent: (event) => {
            this.lastSeq = Math.max(this.lastSeq, event.seq)
            this.state.events.push(event)
            if (this.state.events.length > this.options.maxEvents) {
              this.state.events.splice(0, this.state.events.length - this.options.maxEvents)
            }
            this.scheduleSnapshotRefresh()
            this.render()
          },
        })
      } catch (error) {
        if (this.stopped) {
          break
        }

        const message = error instanceof Error ? error.message : "event stream failure"
        this.state.connection = "error"
        this.setStatus(`Stream error: ${message}`, "red")
      }

      if (this.stopped) break

      await this.delay(this.options.reconnectDelayMs)
    }
  }

  private scheduleSnapshotRefresh() {
    if (this.refreshTimer) return
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined
      void this.refreshSnapshot("event update")
    }, 150)
  }

  private async refreshSnapshot(reason: string) {
    if (this.refreshInFlight) return

    this.refreshInFlight = true
    try {
      const snapshot = await this.client.getSnapshot()
      this.state.snapshot = snapshot
      this.lastSeq = Math.max(this.lastSeq, snapshot.lastSeq)

      const hasSelectedSolver =
        this.state.selectedSolverId &&
        snapshot.solvers.some((solver) => solver.solverId === this.state.selectedSolverId)

      if (!hasSelectedSolver) {
        this.state.selectedSolverId = snapshot.solvers[0]?.solverId
      }

      if (this.state.connection === "connecting") {
        this.state.connection = "connected"
      }

      this.setStatus(`Snapshot refreshed (${reason}).`, "green")
    } catch (error) {
      const message = error instanceof Error ? error.message : "snapshot request failure"
      this.state.connection = "error"
      this.setStatus(`Snapshot error: ${message}`, "red")
    } finally {
      this.refreshInFlight = false
      this.render()
    }
  }

  private render() {
    this.dashboardText.setText(this.renderDashboard())
    this.statusText.setText(this.renderStatus())
    this.tui.requestRender()
  }

  private renderDashboard(): string {
    const lines: string[] = []
    const snapshot = this.state.snapshot

    lines.push(
      `${ANSI.bold}misuzu-cli${ANSI.reset}  ${ANSI.gray}${this.options.serverUrl}${ANSI.reset}`,
    )
    lines.push(`Connection: ${this.formatConnectionState(this.state.connection)}`)

    if (!snapshot) {
      lines.push("")
      lines.push("Waiting for runtime snapshot...")
      return lines.join("\n")
    }

    const usedSlots = snapshot.modelPool.total - snapshot.modelPool.available
    lines.push(
      `Workspace: ${snapshot.workspaceId ?? "n/a"} | Slots: ${usedSlots}/${snapshot.modelPool.total} | Solvers: ${snapshot.solvers.length} | Queue: ${snapshot.challengeQueue.length}`,
    )

    const poolByModel = summarizeModelPool(snapshot.modelPool.slots)
    lines.push(`${ANSI.bold}Model Pool${ANSI.reset}`)
    if (poolByModel.length === 0) {
      lines.push("  (empty)")
    } else {
      for (const model of poolByModel) {
        lines.push(`  - ${model.model}: total=${model.total} idle=${model.idle} busy=${model.busy}`)
      }
    }

    lines.push("")
    lines.push(`${ANSI.bold}Solvers${ANSI.reset}`)
    if (snapshot.solvers.length === 0) {
      lines.push("  (none)")
    } else {
      for (const solver of snapshot.solvers) {
        const selected = solver.solverId === this.state.selectedSolverId ? ">" : " "
        const streaming = solver.isStreaming ? "stream" : "idle"
        lines.push(
          `${selected} ${solver.solverId} | ${solver.status} | ${solver.model ?? "model:n/a"} | msgs=${solver.messageCount} | ${streaming}`,
        )
      }
    }

    lines.push("")
    lines.push(`${ANSI.bold}Queue${ANSI.reset}`)
    if (snapshot.challengeQueue.length === 0) {
      lines.push("  (empty)")
    } else {
      for (const challenge of snapshot.challengeQueue.slice(0, 8)) {
        lines.push(
          `  - ${challenge.challengeId} | ${challenge.challengeName} | ${challenge.category} | d=${challenge.difficulty ?? "n/a"}`,
        )
      }
    }

    const selectedSolver = snapshot.solvers.find(
      (solver) => solver.solverId === this.state.selectedSolverId,
    )
    lines.push("")
    lines.push(`${ANSI.bold}Selected Solver${ANSI.reset}`)
    if (!selectedSolver) {
      lines.push("  (none selected)")
    } else {
      lines.push(`  id: ${selectedSolver.solverId}`)
      lines.push(`  challenge: ${selectedSolver.challengeName ?? "n/a"}`)
      lines.push(`  status: ${selectedSolver.status}`)
      lines.push(`  model: ${selectedSolver.model ?? "n/a"}`)
      lines.push(`  updated: ${selectedSolver.updatedAt ?? "n/a"}`)
    }

    lines.push("")
    lines.push(`${ANSI.bold}Recent Events${ANSI.reset}`)
    const recentEvents = this.state.events.slice(-12)
    if (recentEvents.length === 0) {
      lines.push("  (no events yet)")
    } else {
      for (const event of recentEvents) {
        lines.push(`  #${event.seq} ${event.source}.${event.type} ${summarizeEventPayload(event)}`)
      }
    }

    return lines.join("\n")
  }

  private renderStatus(): string {
    const pending = this.state.commandPending
      ? `${ANSI.yellow}command pending...${ANSI.reset}`
      : `${ANSI.gray}idle${ANSI.reset}`

    return `${ANSI.bold}Status${ANSI.reset}: ${this.state.statusLine} | ${pending}`
  }

  private renderHelpText(): string {
    return [
      `${ANSI.gray}Shortcuts:${ANSI.reset} Ctrl+C quit | Ctrl+R refresh | Alt+J/Alt+K select solver`,
      `${ANSI.gray}Commands:${ANSI.reset} /help /refresh /select <id|next|prev> /steer [id] <msg> /abort [id] /continue [id] /models add <model> [n] /models concurrency <model> <n> /server restart /prompt <msg> /clear-events /quit`,
      `${ANSI.gray}Input:${ANSI.reset} plain text sends coordinator_prompt`,
    ].join("\n")
  }

  private setStatus(message: string, color: "green" | "yellow" | "red" | "gray" = "gray") {
    const prefix =
      color === "green"
        ? ANSI.green
        : color === "yellow"
          ? ANSI.yellow
          : color === "red"
            ? ANSI.red
            : ANSI.gray
    this.state.statusLine = `${prefix}${message}${ANSI.reset}`
    this.render()
  }

  private formatConnectionState(state: RuntimeConnectionState): string {
    switch (state) {
      case "connected":
        return `${ANSI.green}connected${ANSI.reset}`
      case "connecting":
        return `${ANSI.yellow}connecting${ANSI.reset}`
      case "reconnecting":
        return `${ANSI.yellow}reconnecting${ANSI.reset}`
      case "error":
        return `${ANSI.red}error${ANSI.reset}`
    }
  }

  private async delay(ms: number) {
    await new Promise<void>((resolvePromise) => {
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = undefined
        resolvePromise()
      }, ms)
    })
  }

  stop(code: number) {
    if (this.stopped) return
    this.stopped = true

    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = undefined
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }

    if (this.streamAbort) {
      this.streamAbort.abort()
      this.streamAbort = undefined
    }

    this.tui.stop()
    process.exit(code)
  }
}

function parseCliOptions(argv: string[]): CliOptions {
  const flags = new Map<string, string>()
  const positionals: string[] = []

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]
    if (!token.startsWith("--")) {
      positionals.push(token)
      continue
    }

    const key = token.slice(2)
    const next = argv[index + 1]
    if (next && !next.startsWith("--")) {
      flags.set(key, next)
      index += 1
    } else {
      flags.set(key, "true")
    }
  }

  const serverUrl = normalizeServerUrl(
    flags.get("server") ??
      positionals[0] ??
      process.env.MISUZU_SERVER_URL ??
      "http://127.0.0.1:7788",
  )
  const token = flags.get("token") ?? process.env.MISUZU_SERVER_TOKEN
  const tokenFile =
    flags.get("token-file") ??
    process.env.MISUZU_SERVER_TOKEN_FILE ??
    resolve(process.cwd(), ".misuzu", "runtime", "default", "token")

  return {
    serverUrl,
    token: token?.trim() || undefined,
    tokenFile,
    reconnectDelayMs: parseNumber(
      flags.get("reconnect-ms") ?? process.env.MISUZU_RECONNECT_MS,
      1500,
    ),
    maxEvents: parseNumber(flags.get("max-events") ?? process.env.MISUZU_MAX_EVENTS, 300),
  }
}

function normalizeServerUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, "")
  if (normalized.startsWith("http://") || normalized.startsWith("https://")) {
    return normalized
  }
  return `http://${normalized}`
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return parsed
}

function resolveToken(options: CliOptions): string | undefined {
  if (options.token) return options.token
  if (!options.tokenFile) return undefined
  if (!existsSync(options.tokenFile)) return undefined

  const token = readFileSync(options.tokenFile, "utf-8").trim()
  return token.length > 0 ? token : undefined
}

function parseServerEndpoint(serverUrl: string): ParsedServerEndpoint {
  const parsed = new URL(serverUrl)
  const defaultPort = parsed.protocol === "https:" ? 443 : 80
  return {
    host: parsed.hostname,
    port: parsed.port ? Number.parseInt(parsed.port, 10) : defaultPort,
  }
}

async function isDaemonOnline(serverUrl: string, token?: string): Promise<boolean> {
  try {
    const response = await fetch(`${serverUrl}/health`, {
      method: "GET",
      headers: buildAuthHeaders(token),
      signal: AbortSignal.timeout(1200),
    })
    return response.ok
  } catch {
    return false
  }
}

function buildAuthHeaders(token?: string): Record<string, string> {
  if (!token) return {}
  return {
    "x-misuzu-token": token,
    authorization: `Bearer ${token}`,
  }
}

async function promptStartDaemon(serverUrl: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return false
  }

  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await prompt.question(
      `misuzu-server is not running at ${serverUrl}. Start daemon now? [Y/n] `,
    )
    const normalized = answer.trim().toLowerCase()
    if (normalized.length === 0) return true
    return normalized === "y" || normalized === "yes"
  } finally {
    prompt.close()
  }
}

function ensureTokenForDaemon(options: CliOptions, token?: string): string {
  const resolvedToken = token ?? randomBytes(24).toString("hex")

  if (options.tokenFile) {
    const absoluteTokenFile = resolve(options.tokenFile)
    mkdirSync(dirname(absoluteTokenFile), { recursive: true })
    writeFileSync(absoluteTokenFile, `${resolvedToken}\n`, "utf-8")
  }

  return resolvedToken
}

function launchDaemon(options: CliOptions, token: string): DaemonLaunchResult {
  if (!existsSync(inferredServerMainPath)) {
    return {
      ok: false,
      detail: `missing server entrypoint: ${inferredServerMainPath}`,
    }
  }

  const endpoint = parseServerEndpoint(options.serverUrl)
  const args = [
    "--import",
    "tsx",
    inferredServerMainPath,
    "--host",
    endpoint.host,
    "--model",
    "rightcode/gpt-5.4",
    "--port",
    String(endpoint.port),
    "--workspace-root",
    process.cwd(),
    "--token",
    token,
  ]

  if (options.tokenFile) {
    args.push("--token-file", resolve(options.tokenFile))
  }

  try {
    const daemon = spawn(process.execPath, args, {
      cwd: cliPackageDir,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    })
    daemon.unref()
    return { ok: true, detail: "spawned" }
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "spawn failed",
    }
  }
}

async function waitForDaemon(serverUrl: string, token: string): Promise<boolean> {
  const maxAttempts = 12
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (await isDaemonOnline(serverUrl, token)) {
      return true
    }

    await new Promise<void>((resolveDelay) => {
      setTimeout(resolveDelay, 500)
    })
  }

  return false
}

interface ParsedSseRecord {
  event: string
  data: string
}

async function readSseStream(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onRecord: (record: ParsedSseRecord) => void,
) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let eventName = "message"
  let dataLines: string[] = []

  const flushRecord = () => {
    if (dataLines.length === 0) {
      eventName = "message"
      return
    }

    onRecord({
      event: eventName,
      data: dataLines.join("\n"),
    })

    eventName = "message"
    dataLines = []
  }

  while (!signal.aborted) {
    const chunk = await reader.read()
    if (chunk.done) {
      flushRecord()
      break
    }

    buffer += decoder.decode(chunk.value, { stream: true })

    while (true) {
      const newlineIndex = buffer.indexOf("\n")
      if (newlineIndex === -1) break

      const rawLine = buffer.slice(0, newlineIndex)
      buffer = buffer.slice(newlineIndex + 1)
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine

      if (line.length === 0) {
        flushRecord()
        continue
      }

      if (line.startsWith(":")) {
        continue
      }

      const separatorIndex = line.indexOf(":")
      const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex)
      const rawValue = separatorIndex === -1 ? "" : line.slice(separatorIndex + 1)
      const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue

      if (field === "event") {
        eventName = value
      } else if (field === "data") {
        dataLines.push(value)
      }
    }
  }

  reader.releaseLock()
}

function parseRuntimeEventEnvelope(payload: string): RuntimeEventEnvelope | undefined {
  let parsed: RuntimeJsonValue
  try {
    parsed = JSON.parse(payload) as RuntimeJsonValue
  } catch {
    return undefined
  }

  if (!isRuntimeJsonObject(parsed)) return undefined

  const seq = parsed.seq
  const ts = parsed.ts
  const source = parsed.source
  const type = parsed.type
  const envelopePayload = parsed.payload

  if (typeof seq !== "number") return undefined
  if (typeof ts !== "string") return undefined
  if (source !== "server" && source !== "coordinator" && source !== "solver") return undefined
  if (typeof type !== "string") return undefined
  if (envelopePayload === undefined) return undefined

  return {
    seq,
    ts,
    source,
    type,
    payload: envelopePayload,
  }
}

function isRuntimeJsonObject(
  value: RuntimeJsonValue,
): value is { [key: string]: RuntimeJsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function summarizeModelPool(slots: ModelPoolSlotSnapshot[]) {
  const byModel = new Map<string, { model: string; total: number; idle: number; busy: number }>()

  for (const slot of slots) {
    const entry = byModel.get(slot.model) ?? {
      model: slot.model,
      total: 0,
      idle: 0,
      busy: 0,
    }

    entry.total += 1
    if (slot.status === "idle") {
      entry.idle += 1
    } else {
      entry.busy += 1
    }

    byModel.set(slot.model, entry)
  }

  return Array.from(byModel.values()).sort((a, b) => a.model.localeCompare(b.model))
}

function summarizeEventPayload(event: RuntimeEventEnvelope): string {
  const payload = event.payload
  if (!isRuntimeJsonObject(payload)) {
    return compactJson(payload)
  }

  if (event.type === "solver.message") {
    const solverId = typeof payload.solverId === "string" ? payload.solverId : "solver"
    const summary = typeof payload.summary === "string" ? payload.summary : "message"
    return `${solverId}: ${truncate(summary, 80)}`
  }

  if (event.type === "coordinator.message") {
    const summary = typeof payload.summary === "string" ? payload.summary : "message"
    return truncate(summary, 80)
  }

  if (event.type === "solver.tool.start" || event.type === "solver.tool.end") {
    const solverId = typeof payload.solverId === "string" ? payload.solverId : "solver"
    const toolName = typeof payload.toolName === "string" ? payload.toolName : "tool"
    return `${solverId} ${toolName}`
  }

  if (event.type === "coordinator.tool.start" || event.type === "coordinator.tool.end") {
    const toolName = typeof payload.toolName === "string" ? payload.toolName : "tool"
    return toolName
  }

  if (event.type === "runtime.command.executed" || event.type === "runtime.command.accepted") {
    const command = typeof payload.command === "string" ? payload.command : "command"
    return command
  }

  return truncate(compactJson(payload), 100)
}

function compactJson(value: RuntimeJsonValue): string {
  return JSON.stringify(value)
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}...`
}

async function main() {
  const options = parseCliOptions(process.argv.slice(2))
  let token = resolveToken(options)

  const daemonOnline = await isDaemonOnline(options.serverUrl, token)
  if (!daemonOnline) {
    const shouldStart = await promptStartDaemon(options.serverUrl)
    if (shouldStart) {
      token = ensureTokenForDaemon(options, token)
      const launch = launchDaemon(options, token)

      if (!launch.ok) {
        console.log(`[misuzu-cli] failed to start daemon: ${launch.detail}`)
      } else {
        const becameAvailable = await waitForDaemon(options.serverUrl, token)
        if (!becameAvailable) {
          console.log("[misuzu-cli] daemon start requested, still waiting for /health...")
        }
      }
    }
  }

  const app = new MisuzuCliApp({
    ...options,
    token,
  })

  await app.start()
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : "startup failure"
  console.error(`[misuzu-cli] fatal: ${message}`)
  process.exit(1)
})
