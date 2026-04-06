import { computed } from "vue"
import type { PromptMode } from "../../shared/protocol.ts"
import { useAppServices } from "../di/app-services.ts"
import { useSolverWorkspaceStore } from "../stores/solver-workspace.ts"

export function useSolverWorkspace(workspaceId: string) {
  const store = useSolverWorkspaceStore()
  store.bindServices(useAppServices())

  return {
    snapshot: computed(() => store.snapshots[workspaceId]),
    state: computed(() => store.agentStates[workspaceId]),
    error: computed(() => store.error),
    loading: computed(() => store.loading),
    open: () => store.openWorkspace(workspaceId),
    prompt: (prompt: string, mode: PromptMode = "followup") =>
      store.prompt(workspaceId, prompt, mode),
    disconnect: () => store.disconnectWorkspaceFeed(workspaceId),
  }
}
