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
import { filterImportantEvents, formatImportantEvent, type EventTab } from "./ui-events.ts"

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
  status: "assigned" | "url_pending" | "solving" | "solved" | "failed" | "stopped"
  model?: string
  messageCount: number
  isStreaming: boolean
  updatedAt?: string
}

interface RuntimeSnapshot {
  protocolVersion: number
  coordinatorStatus: "active" | "idle"
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
  urlPendingQueue: Array<{
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

interface SolverStopPayload {
  solverId: string
}

interface LoadWorkspacePayload {
  workspaceDir: string
  autoContinueSolvers?: boolean
}

interface ShutdownCoordinatorPayload {
  graceful?: boolean
}

interface WorkspaceSummary {
  workspaceId: string
  workspaceDir: string
  platformUrl?: string
  updatedAt?: string
}

interface RuntimeCommandPayloadMap {
  coordinator_prompt: CoordinatorPromptPayload
  solver_steer: SolverSteerPayload
  solver_abort: SolverAbortPayload
  solver_continue: SolverContinuePayload
  solver_stop: SolverStopPayload
  add_model_to_pool: AddModelToPoolPayload
  set_model_concurrency: SetModelConcurrencyPayload
  server_restart: ServerRestartPayload
  load_workspace: LoadWorkspacePayload
  shutdown_coordinator: ShutdownCoordinatorPayload
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
  eventTab: EventTab
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

  async checkHealth(signal?: AbortSignal): Promise<{
    ok: boolean
    coordinatorStatus: "active" | "idle"
    workspaceId?: string
  }> {
    const response = await fetch(`${this.serverUrl}/health`, {
      method: "GET",
      headers: this.buildHeaders(),
      signal,
    })
    return (await response.json()) as {
      ok: boolean
      coordinatorStatus: "active" | "idle"
      workspaceId?: string
    }
  }

  async listWorkspaces(signal?: AbortSignal): Promise<{
    ok: boolean
    workspaces: WorkspaceSummary[]
  }> {
    const response = await fetch(`${this.serverUrl}/workspaces`, {
      method: "GET",
      headers: this.buildHeaders(),
      signal,
    })
    return (await response.json()) as {
      ok: boolean
      workspaces: WorkspaceSummary[]
    }
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
    eventTab: "coordinator",
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
  private mode: "dashboard" | "workspace-picker" = "dashboard"
  private workspaceOptions: WorkspaceSummary[] = []
  private workspaceCursor = 0

  constructor(options: CliOptions) {
    this.options = options
    this.client = new MisuzuServerClient(options.serverUrl, options.token)

    this.editor.setAutocompleteProvider(
      new CombinedAutocompleteProvider(
        [
          { name: "help", description: "Show command guide" },
          { name: "refresh", description: "Refresh runtime snapshot" },
          { name: "tab", description: "Switch event tab" },
          { name: "select", description: "Select solver by id or next/prev" },
          { name: "steer", description: "Send hint to selected solver" },
          { name: "abort", description: "Abort selected solver" },
          { name: "continue", description: "Continue selected solver" },
          { name: "stop", description: "Stop solver [id]" },
          { name: "models", description: "Manage model pool and concurrency" },
          { name: "server", description: "Server operations (restart)" },
          { name: "kernel", description: "Kernel operations (stop)" },
          { name: "prompt", description: "Send prompt to coordinator" },
          { name: "resume", description: "Select and resume workspace" },
          { name: "clear-events", description: "Clear local event panel" },
          { name: "quit", description: "Quit TUI" },
        ],
        process.cwd(),
      ),
    )
  }

  async checkHealth(): Promise<{
    ok: boolean
    coordinatorStatus: "active" | "idle"
    workspaceId?: string
  }> {
    return this.client.checkHealth()
  }

  async startInWorkspacePicker() {
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

      if (this.mode === "workspace-picker") {
        if (matchesKey(data, Key.up) || matchesKey(data, Key.alt("k"))) {
          this.moveWorkspaceCursor(-1)
          return { consume: true }
        }
        if (matchesKey(data, Key.down) || matchesKey(data, Key.alt("j"))) {
          this.moveWorkspaceCursor(1)
          return { consume: true }
        }
        if (matchesKey(data, Key.enter)) {
          void this.handleWorkspacePickerSelect()
          return { consume: true }
        }
        return { consume: true }
      }

      return undefined
    })

    this.tui.start()
    this.setStatus("Server is idle. No active coordinator.", "yellow")
    this.render()

    await this.enterWorkspacePicker()
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

      // Workspace picker navigation
      if (this.mode === "workspace-picker") {
        if (matchesKey(data, Key.up) || matchesKey(data, Key.alt("k"))) {
          this.moveWorkspaceCursor(-1)
          return { consume: true }
        }
        if (matchesKey(data, Key.down) || matchesKey(data, Key.alt("j"))) {
          this.moveWorkspaceCursor(1)
          return { consume: true }
        }
        if (matchesKey(data, Key.enter)) {
          void this.handleWorkspacePickerSelect()
          return { consume: true }
        }
        return { consume: true }
      }

      if (matchesKey(data, Key.ctrl("r"))) {
        void this.refreshSnapshot("manual refresh")
        return { consume: true }
      }

      if (matchesKey(data, Key.alt("1"))) {
        this.state.eventTab = "coordinator"
        this.setStatus("Switched to coordinator tab.")
        return { consume: true }
      }

      if (matchesKey(data, Key.alt("2"))) {
        this.state.eventTab = "solver"
        this.setStatus(
          this.state.selectedSolverId
            ? `Switched to solver tab (${this.state.selectedSolverId}).`
            : "Switched to solver tab (no solver selected).",
        )
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
          "Commands: /help /refresh /tab /select /steer /abort /continue /stop /models /server restart /kernel stop /resume /prompt /clear-events /quit",
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

      case "tab":
        this.handleTabCommand(rest)
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

      case "stop":
        await this.handleSolverStopCommand(rest)
        return

      case "kernel":
        await this.handleKernelCommand(rest)
        return

      case "resume":
        await this.enterWorkspacePicker()
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

  private handleTabCommand(argument: string) {
    const value = argument.trim()
    if (value.length === 0) {
      this.setStatus("Usage: /tab coordinator | /tab solver [solver-id]", "yellow")
      return
    }

    const [tabName, solverId] = value.split(/\s+/, 2)
    if (tabName === "coordinator") {
      this.state.eventTab = "coordinator"
      this.setStatus("Switched to coordinator tab.")
      return
    }

    if (tabName === "solver") {
      if (solverId) {
        const resolved = this.resolveSolverId(solverId)
        if (!resolved) {
          this.setStatus(`Solver not found: ${solverId}`, "yellow")
          return
        }
        this.state.selectedSolverId = resolved
      }

      this.state.eventTab = "solver"
      this.setStatus(
        this.state.selectedSolverId
          ? `Switched to solver tab (${this.state.selectedSolverId}).`
          : "Switched to solver tab (no solver selected).",
      )
      return
    }

    this.setStatus("Usage: /tab coordinator | /tab solver [solver-id]", "yellow")
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

  private async handleSolverStopCommand(argument: string) {
    const solverId = this.resolveSolverId(argument.trim()) ?? this.state.selectedSolverId
    if (!solverId) {
      this.setStatus("No solver selected. Use /stop <solver-id>.", "yellow")
      return
    }

    const response = await this.client.sendCommand({
      command: "solver_stop",
      payload: { solverId },
    })
    this.handleCommandResponse(response, `Solver ${solverId} stopped.`)
  }

  private async handleKernelCommand(argument: string) {
    const action = argument.trim().toLowerCase()
    if (action !== "stop") {
      this.setStatus("Usage: /kernel stop", "yellow")
      return
    }

    const response = await this.client.sendCommand({
      command: "shutdown_coordinator",
      payload: { graceful: true },
    })

    if (!response.ok) {
      this.setStatus(`Kernel stop failed: ${response.error ?? "request failed"}`, "red")
      return
    }

    this.setStatus("Coordinator stopped. Server is idle.", "green")
    this.state.snapshot = undefined
    this.state.selectedSolverId = undefined
    this.state.events = []
    this.render()
    await this.enterWorkspacePicker()
  }

  async enterWorkspacePicker() {
    this.mode = "workspace-picker"
    this.workspaceCursor = 0
    this.setStatus("Fetching available workspaces...")

    try {
      const result = await this.client.listWorkspaces()
      this.workspaceOptions = result.workspaces
      this.renderWorkspacePicker()
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to list workspaces"
      this.setStatus(`Workspace list error: ${message}`, "red")
      this.mode = "dashboard"
      this.render()
    }
  }

  private moveWorkspaceCursor(direction: number) {
    const maxIndex = this.workspaceOptions.length // last index = "Create new"
    this.workspaceCursor = Math.max(0, Math.min(maxIndex, this.workspaceCursor + direction))
    this.renderWorkspacePicker()
  }

  private renderWorkspacePicker() {
    const lines: string[] = []
    lines.push(
      `${ANSI.bold}misuzu-cli${ANSI.reset}  ${ANSI.gray}${this.options.serverUrl}${ANSI.reset}`,
    )
    lines.push("")

    if (this.workspaceOptions.length === 0) {
      lines.push("No workspaces found.")
      lines.push("")
      lines.push(`${ANSI.cyan}>${ANSI.reset} ${ANSI.yellow}[Create new workspace]${ANSI.reset}`)
    } else {
      lines.push("Select a workspace to resume:")
      lines.push("")

      for (let i = 0; i < this.workspaceOptions.length; i++) {
        const ws = this.workspaceOptions[i]
        const prefix = i === this.workspaceCursor ? `${ANSI.cyan}>${ANSI.reset}` : " "
        const updated = ws.updatedAt ? ws.updatedAt.slice(0, 19) : "n/a"
        lines.push(`  ${prefix} ${ws.workspaceId}  ${ANSI.gray}(updated: ${updated})${ANSI.reset}`)
      }

      const createIdx = this.workspaceOptions.length
      const createPrefix = this.workspaceCursor === createIdx ? `${ANSI.cyan}>${ANSI.reset}` : " "
      lines.push(`  ${createPrefix} ${ANSI.yellow}[Create new workspace]${ANSI.reset}`)
    }

    lines.push("")
    lines.push(`${ANSI.gray}Up/Down: navigate  Enter: select  Ctrl+C: quit${ANSI.reset}`)

    this.dashboardText.setText(lines.join("\n"))
    this.tui.requestRender()
  }

  private async handleWorkspacePickerSelect() {
    const isCreateNew = this.workspaceCursor === this.workspaceOptions.length

    if (isCreateNew) {
      this.setStatus("Creating new workspace...", "yellow")
      this.mode = "dashboard"
      this.state.connection = "connected"
      this.render()

      // Start a fresh coordinator via the server
      const response = await this.client.sendCommand({
        command: "load_workspace",
        payload: { workspaceDir: "" },
      })
      if (!response.ok) {
        this.setStatus(
          `New workspace creation requires server restart. Use: /server restart`,
          "yellow",
        )
      }
      return
    }

    const selected = this.workspaceOptions[this.workspaceCursor]
    if (!selected) return

    this.setStatus(`Loading workspace ${selected.workspaceId}...`, "yellow")

    try {
      const response = await this.client.sendCommand({
        command: "load_workspace",
        payload: { workspaceDir: selected.workspaceDir },
      })

      if (!response.ok) {
        this.setStatus(`Load failed: ${response.error ?? "request failed"}`, "red")
        return
      }

      this.setStatus(`Workspace ${selected.workspaceId} loaded.`, "green")
      this.mode = "dashboard"
      this.state.connection = "connected"
      this.lastSeq = 0
      await this.refreshSnapshot("workspace loaded")
      void this.runEventLoop()
    } catch (error) {
      const message = error instanceof Error ? error.message : "load failed"
      this.setStatus(`Load error: ${message}`, "red")
    }
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

    const coordStatus =
      snapshot.coordinatorStatus === "active"
        ? `${ANSI.green}active${ANSI.reset}`
        : `${ANSI.yellow}idle${ANSI.reset}`
    const usedSlots = snapshot.modelPool.total - snapshot.modelPool.available
    lines.push(
      `Coordinator: ${coordStatus} | Workspace: ${snapshot.workspaceId ?? "n/a"} | Slots: ${usedSlots}/${snapshot.modelPool.total} | Solvers: ${snapshot.solvers.length} | Queue: ${snapshot.challengeQueue.length} | URL Pending: ${snapshot.urlPendingQueue.length}`,
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

    lines.push("")
    lines.push(`${ANSI.bold}URL Pending${ANSI.reset}`)
    if (snapshot.urlPendingQueue.length === 0) {
      lines.push("  (empty)")
    } else {
      for (const challenge of snapshot.urlPendingQueue.slice(0, 8)) {
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
    lines.push(`${ANSI.bold}Events${ANSI.reset}`)
    const tabLabel =
      this.state.eventTab === "coordinator"
        ? "coordinator"
        : `solver${this.state.selectedSolverId ? `:${this.state.selectedSolverId}` : ""}`
    lines.push(`  tab: ${tabLabel}`)

    const visibleEvents = filterImportantEvents(this.state.events, {
      tab: this.state.eventTab,
      selectedSolverId: this.state.selectedSolverId,
      limit: 12,
    })

    if (visibleEvents.length === 0) {
      lines.push("  (no important events yet)")
    } else {
      for (const event of visibleEvents) {
        lines.push(`  #${event.seq} ${formatImportantEvent(event)}`)
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
      `${ANSI.gray}Shortcuts:${ANSI.reset} Ctrl+C quit | Ctrl+R refresh | Alt+1 coordinator tab | Alt+2 solver tab | Alt+J/Alt+K select solver`,
      `${ANSI.gray}Commands:${ANSI.reset} /help /refresh /tab coordinator|solver [id] /select <id|next|prev> /steer [id] <msg> /abort [id] /continue [id] /stop [id] /models add <model> [n] /models concurrency <model> <n> /server restart /kernel stop /resume /prompt <msg> /clear-events /quit`,
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
    "swpumc/gpt-5.2-codex",
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

  // Check if server is idle before starting TUI
  try {
    const health = await app.checkHealth()
    if (health.coordinatorStatus === "idle") {
      // Start TUI in workspace picker mode
      await app.startInWorkspacePicker()
      return
    }
  } catch {
    // Health check failed, proceed with normal start
  }

  await app.start()
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : "startup failure"
  console.error(`[misuzu-cli] fatal: ${message}`)
  process.exit(1)
})
