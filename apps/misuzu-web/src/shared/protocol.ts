export type WorkspaceKind = "ctf-runtime" | "solver"

export type AgentRole = "environment" | "solver"

export interface WorkspaceRegistryEntry {
  id: string
  kind: WorkspaceKind
  name: string
  rootDir: string
  createdAt: string
  updatedAt: string
  runtime?: {
    initialized: boolean
    pluginId?: string
    autoOrchestrate: boolean
  }
}

export interface ModelPoolInput {
  provider: string
  modelId: string
  maxConcurrency: number
}

export interface ModelPoolSnapshotItem extends ModelPoolInput {
  inUse: number
  available: number
  modelResolved: boolean
}

export interface ModelPoolSnapshot {
  items: ModelPoolSnapshotItem[]
  totalCapacity: number
  totalInUse: number
  totalAvailable: number
  hasAvailableModel: boolean
}

export interface RuntimeCreateRequest {
  id?: string
  name?: string
  rootDir?: string
  pluginId?: string
  pluginConfig?: {
    baseUrl: string
    contest:
      | { mode: "auto" }
      | { mode: "id"; value: number }
      | { mode: "title"; value: string }
      | { mode: "url"; value: string }
    auth?: {
      mode: "manual" | "cookie" | "token" | "credentials"
      cookie?: string
      bearerToken?: string
      username?: string
      password?: string
      loginUrl?: string
      authCheckUrl?: string
      timeoutSec?: number
    }
  }
  modelPool: ModelPoolInput[]
  autoOrchestrate?: boolean
  createEnvironmentAgent?: boolean
}

export interface SolverCreateRequest {
  id?: string
  name?: string
  rootDir?: string
  model?: {
    provider: string
    modelId: string
  }
  systemPrompt?: string
}

export interface ChallengeSummaryView {
  challengeId: number
  solverId: string
  title: string
  category: string
  requiresContainer?: boolean
  score: number
  solvedCount: number
  status: "active" | "queued" | "solved" | "blocked" | "idle"
  activeTaskId?: string
  queuedTaskId?: string
  statusReason?: string
  modelId?: string
}

export interface RuntimeWorkspaceSnapshot {
  id: string
  rootDir: string
  initialized: boolean
  pluginId?: string
  paused: boolean
  queue: {
    paused: boolean
    pendingTaskCount: number
    idleSolverCount: number
    busySolverCount: number
    registeredSolverCount: number
  }
  modelPool: ModelPoolSnapshot
  challenges: ChallengeSummaryView[]
  agents: Array<{
    id: string
    name: string
    role: AgentRole
    challengeId?: number
  }>
  environmentAgentReady: boolean
  autoOrchestrate: boolean
}

export interface SolverWorkspaceSnapshot {
  id: string
  rootDir: string
  hasMainAgent: boolean
  modelId?: string
  messageCount: number
}

export interface AgentMessageTextPart {
  kind: "text"
  text: string
}

export interface AgentMessageToolPart {
  kind: "tool"
  toolType: string
  name?: string
  argsText?: string
  resultText?: string
}

export type AgentMessagePart = AgentMessageTextPart | AgentMessageToolPart

export interface AgentStateSnapshot {
  modelId?: string
  thinkingLevel?: string
  isRunning: boolean
  messages: Array<{
    role: string
    text: string
    parts?: AgentMessagePart[]
    timestamp?: number
  }>
}

export type PromptMode = "followup" | "steer"

export interface PromptRequest {
  prompt: string
  mode?: PromptMode
}

export interface PluginCatalogItem {
  id: string
  name: string
  description?: string
}

export interface PluginReadmeResponse {
  id: string
  markdown: string
}

export interface RuntimeInitRequest {
  pluginId: string
  pluginConfig: NonNullable<RuntimeCreateRequest["pluginConfig"]>
}

export interface RuntimeDispatchRequest {
  autoEnqueue?: boolean
}

export interface RuntimeModelPoolUpdateRequest {
  modelPool: ModelPoolInput[]
}

export interface RuntimeEnqueueRequest {
  challengeId: number
}

export interface WsMessage<TType extends string = string, TPayload = unknown> {
  type: TType
  payload: TPayload
}

export type WsServerMessage =
  | WsMessage<"registry.updated", { entries: WorkspaceRegistryEntry[] }>
  | WsMessage<"runtime.snapshot", { workspaceId: string; snapshot: RuntimeWorkspaceSnapshot }>
  | WsMessage<
      "solver.snapshot",
      {
        workspaceId: string
        snapshot: SolverWorkspaceSnapshot
      }
    >
  | WsMessage<
      "agent.event",
      {
        workspaceId: string
        agentId: string
        source: "runtime" | "solver"
        event: unknown
      }
    >
  | WsMessage<"error", { message: string }>
