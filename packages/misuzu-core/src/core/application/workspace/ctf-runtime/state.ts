import type { AgentMessage, AgentState } from "@mariozechner/pi-agent-core"
import type { AuthSession, PluginConfig } from "../../../../../plugins/index.ts"

export const CTF_RUNTIME_STATE_VERSION = "1.0.0"

export interface PersistedCTFRuntimeState {
  runtimeId: string
  payload: Record<string, unknown>
}

// Payload used when EnvironmentAgent is attached before runtime plugin activation.
export interface PersistedEnvironmentAgentRuntimeState extends Record<string, unknown> {
  modelId?: string
  baseSystemPrompt?: string
  thinkingLevel?: AgentState["thinkingLevel"]
  messages: AgentMessage[]
}

export interface PersistedCTFRuntimeConfig {
  pluginId: string
  pluginConfig: PluginConfig
  cron?: {
    noticePollIntervalMs?: number
    challengeSyncIntervalMs?: number
  }
}

export interface PersistedCTFRuntimeQueueTask {
  taskId: string
  challengeId?: number
  targetSolverId?: string
  payload: unknown
  source?: "auto" | "manual"
  priority?: number
  createdAt?: number
  reason?: string
}

export interface PersistedCTFRuntimeInflightTask {
  solverId: string
  taskId: string
  challengeId?: number
  targetSolverId?: string
  payload: unknown
  source?: "auto" | "manual"
  priority?: number
  createdAt?: number
  reason?: string
}

export interface PersistedCTFRuntimeQueueState {
  taskSequence: number
  paused: boolean
  pendingTasks: PersistedCTFRuntimeQueueTask[]
  inflightTasks: PersistedCTFRuntimeInflightTask[]
}

export interface PersistedCTFRuntimeSchedulerIntent {
  taskId: string
  challengeId: number
  source: "auto" | "manual"
  priority: number
  createdAt: number
  payload: unknown
  reason?: string
}

export interface PersistedCTFRuntimeSchedulerState {
  taskCounter: number
  autoManaged: boolean
  paused: boolean
  pendingIntents: PersistedCTFRuntimeSchedulerIntent[]
}

export interface PersistedCTFRuntimeManagedChallenge {
  challengeId: number
  solverId: string
  title: string
  category: string
  requiresContainer?: boolean
  score: number
  solvedCount: number
}

export interface PersistedCTFRuntimeChallengeProgress {
  challengeId: number
  solverId: string
  status: "idle" | "writeup_required" | "solved" | "blocked"
  flagAccepted: boolean
  writeUpReady: boolean
  blockedReason?: string
}

export interface PersistedCTFRuntimeSyncState {
  noticeCursor?: string
}

export interface PersistedCTFRuntimePlatformState {
  authSession?: AuthSession
  contestId?: number
}

export interface PersistedCTFRuntimeSolverHubState {
  managedChallenges: PersistedCTFRuntimeManagedChallenge[]
  challengeProgress: PersistedCTFRuntimeChallengeProgress[]
}

export interface PersistedCTFRuntimeSnapshot {
  runtimeConfig: PersistedCTFRuntimeConfig
  platform: PersistedCTFRuntimePlatformState
  sync: PersistedCTFRuntimeSyncState
  queue: PersistedCTFRuntimeQueueState
  scheduler?: PersistedCTFRuntimeSchedulerState
  solverHub: PersistedCTFRuntimeSolverHubState
}

export interface PersistedCTFRuntimeWorkspaceState {
  version: string
  lastModified: string
  // Dedicated EnvironmentAgent snapshot retained across runtime switches.
  environmentRuntimeState?: PersistedEnvironmentAgentRuntimeState
  runtimeState?: PersistedCTFRuntimeState
  runtime?: PersistedCTFRuntimeSnapshot
}
