import type { Model, StopReason } from "@mariozechner/pi-ai"
import type { FeaturedAgentOptions } from "../misuzu-featured.ts"
import type { CompetitionPersistence, JsonObject } from "../../features/persistence.ts"
import type { ModelPool, ModelSlot } from "./model-pool.ts"

export interface CoordinatorOptions {
  cwd?: string
  workspaceRoot?: string
  workspaceId?: string
  ctfPlatformUrl?: string
  models?: string[]
  modelConcurrency?: number
  remoteUrlConcurrency?: number
  model?: Model<any>
  modelResolver?: (modelId: string) => Model<any> | undefined
  modelPool?: ModelPool
  persistence?: CompetitionPersistence
}

export interface Challenge {
  id: string
  name: string
  category: string
  description: string
  difficulty?: number
  files?: string[]
  points?: number
}

export type QueuedChallenge = {
  challengeId: string
  challengeName: string
  category: string
  description: string
  difficulty?: number
  files?: string[]
  remoteUrl?: string
}

export type SolverNotificationKind =
  | "environment_expired"
  | "environment_url"
  | "hint"
  | "platform_notice"

export interface SolverNotification {
  kind: SolverNotificationKind
  content: string
  url?: string
  expiresAt?: string
}

export type NotificationSource = "coordinator" | "solver"

export interface PersistedCoordinatorState extends JsonObject {
  workspaceRoot?: string
  modelPool?: ModelSlot[]
  solvers?: string[]
  challengeQueue?: QueuedChallenge[]
  urlPendingQueue?: QueuedChallenge[]
}

export interface PersistedSolverState extends JsonObject {
  solverId?: string
  challengeName?: string
  category?: string
  description?: string
  difficulty?: number
  files?: string[]
  status?: string
  model?: string
  remoteUrl?: string
  requiresRemoteUrl?: boolean
  cwd?: string
  environmentPath?: string
  scriptsDir?: string
  writeupPath?: string
  lastAgentEndReason?: string
  lastAgentEndError?: string
  lastAgentEndAt?: string
}

export type SolverRunEndMeta = {
  stopReason: StopReason
  errorMessage?: string
}

export interface ResumeCoordinatorOptions {
  workspaceDir: string
  autoContinueSolvers?: boolean
  cwd?: CoordinatorOptions["cwd"]
  workspaceRoot?: CoordinatorOptions["workspaceRoot"]
  ctfPlatformUrl?: CoordinatorOptions["ctfPlatformUrl"]
  models?: CoordinatorOptions["models"]
  modelConcurrency?: CoordinatorOptions["modelConcurrency"]
  model?: CoordinatorOptions["model"]
  modelResolver?: CoordinatorOptions["modelResolver"]
  initialState?: FeaturedAgentOptions["initialState"]
  skills?: FeaturedAgentOptions["skills"]
  convertToLlm?: FeaturedAgentOptions["convertToLlm"]
  transformContext?: FeaturedAgentOptions["transformContext"]
}
