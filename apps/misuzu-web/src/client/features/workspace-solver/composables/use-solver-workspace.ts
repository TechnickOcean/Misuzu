import { computed } from "vue"
import type { PromptMode } from "@shared/protocol.ts"
import { useAppServices } from "@/shared/di/app-services.ts"
import { useSolverWorkspaceStore } from "@/features/workspace-solver/stores/solver-workspace-store.ts"

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
