import type { PluginConfig } from "../../../../../plugins/index.ts"

export const CTF_RUNTIME_STATE_VERSION = "1.0.0"

export interface PersistedCTFRuntimeState {
  runtimeId: string
  payload: Record<string, unknown>
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

export interface PersistedCTFRuntimeSolverHubState {
  managedChallenges: PersistedCTFRuntimeManagedChallenge[]
}

export interface PersistedCTFRuntimeSnapshot {
  runtimeConfig: PersistedCTFRuntimeConfig
  pluginState?: Record<string, unknown>
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
