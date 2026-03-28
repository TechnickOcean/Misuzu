export const SERVER_PROTOCOL_VERSION = 1

export type RuntimeJsonValue =
  | string
  | number
  | boolean
  | null
  | RuntimeJsonValue[]
  | { [key: string]: RuntimeJsonValue }

export type RuntimeEventSource = "server" | "coordinator" | "solver"

export interface RuntimeEventEnvelope<TPayload extends RuntimeJsonValue = RuntimeJsonValue> {
  seq: number
  ts: string
  source: RuntimeEventSource
  type: string
  payload: TPayload
}

export interface ModelPoolSlotSnapshot {
  model: string
  status: "idle" | "busy"
  solverId?: string
}

export interface SolverSnapshot {
  solverId: string
  challengeName?: string
  status: "assigned" | "url_pending" | "solving" | "solved" | "failed" | "stopped"
  model?: string
  messageCount: number
  isStreaming: boolean
  updatedAt?: string
}

export interface RuntimeSnapshot {
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

export interface CoordinatorPromptCommandPayload {
  message: string
}

export interface CreateSolverCommandPayload {
  challengeId: string
  challengeName: string
  category: string
  description: string
  difficulty?: number
  files?: string[]
  remoteUrl?: string
}

export interface UpdateSolverEnvironmentCommandPayload {
  challengeId: string
  updateType: "environment_url" | "hint" | "platform_notice"
  content: string
  url?: string
  expiresAt?: string
}

export interface ConfirmSolverFlagCommandPayload {
  challengeId: string
  flag: string
  correct: boolean
  message?: string
}

export interface SolverSteerCommandPayload {
  solverId: string
  message: string
}

export interface SolverAbortCommandPayload {
  solverId: string
}

export interface SolverContinueCommandPayload {
  solverId: string
}

export interface ServerRestartCommandPayload {
  graceful?: boolean
}

export interface AddModelToPoolCommandPayload {
  modelId: string
  concurrency?: number
}

export interface SetModelConcurrencyCommandPayload {
  modelId: string
  concurrency: number
}

export interface RuntimeCommandPayloadMap {
  coordinator_prompt: CoordinatorPromptCommandPayload
  create_solver: CreateSolverCommandPayload
  update_solver_environment: UpdateSolverEnvironmentCommandPayload
  confirm_solver_flag: ConfirmSolverFlagCommandPayload
  solver_steer: SolverSteerCommandPayload
  solver_abort: SolverAbortCommandPayload
  solver_continue: SolverContinueCommandPayload
  server_restart: ServerRestartCommandPayload
  add_model_to_pool: AddModelToPoolCommandPayload
  set_model_concurrency: SetModelConcurrencyCommandPayload
}

export type RuntimeCommandName = keyof RuntimeCommandPayloadMap

export type RuntimeCommandRequestFor<TCommand extends RuntimeCommandName> = {
  command: TCommand
  payload: RuntimeCommandPayloadMap[TCommand]
  requestId?: string
}

export type RuntimeCommandRequest = {
  [TCommand in RuntimeCommandName]: RuntimeCommandRequestFor<TCommand>
}[RuntimeCommandName]

export interface RuntimeCommandResponse<TPayload extends RuntimeJsonValue = RuntimeJsonValue> {
  ok: boolean
  requestId?: string
  payload?: TPayload
  error?: string
}

export interface WorkspaceSummary {
  workspaceId: string
  workspaceDir: string
  platformUrl?: string
  updatedAt?: string
}
