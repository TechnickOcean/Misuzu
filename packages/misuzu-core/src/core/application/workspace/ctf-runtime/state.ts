export const CTF_RUNTIME_STATE_VERSION = "1.0.0"

export interface PersistedCTFRuntimeState {
  runtimeId: string
  payload: Record<string, unknown>
}

export interface PersistedCTFRuntimeWorkspaceState {
  version: string
  lastModified: string
  runtimeState?: PersistedCTFRuntimeState
}
