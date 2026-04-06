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
  payload: unknown
}

export interface PersistedCTFRuntimeInflightTask {
  solverId: string
  taskId: string
  payload: unknown
}

export interface PersistedCTFRuntimeQueueState {
  taskSequence: number
  paused: boolean
  pendingTasks: PersistedCTFRuntimeQueueTask[]
  inflightTasks: PersistedCTFRuntimeInflightTask[]
}

export interface PersistedCTFRuntimeManagedChallenge {
  challengeId: number
  solverId: string
  title: string
  category: string
  score: number
  solvedCount: number
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
}

export interface PersistedCTFRuntimeSnapshot {
  runtimeConfig: PersistedCTFRuntimeConfig
  platform: PersistedCTFRuntimePlatformState
  sync: PersistedCTFRuntimeSyncState
  queue: PersistedCTFRuntimeQueueState
  solverHub: PersistedCTFRuntimeSolverHubState
}

export interface PersistedCTFRuntimeWorkspaceState {
  version: string
  lastModified: string
  runtimeState?: PersistedCTFRuntimeState
  runtime?: PersistedCTFRuntimeSnapshot
}
