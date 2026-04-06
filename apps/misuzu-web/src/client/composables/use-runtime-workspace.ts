import { computed } from "vue"
import type { ModelPoolInput, PromptMode, RuntimeInitRequest } from "../../shared/protocol.ts"
import { useAppServices } from "../di/app-services.ts"
import { useRuntimeWorkspaceStore } from "../stores/runtime-workspace.ts"

export function useRuntimeWorkspace(workspaceId: string) {
  const store = useRuntimeWorkspaceStore()
  store.bindServices(useAppServices())

  const snapshot = computed(() => store.snapshots[workspaceId])
  const activeAgentId = computed(() => store.activeAgentIds[workspaceId])
  const activeAgentState = computed(() => {
    const agentId = store.activeAgentIds[workspaceId]
    if (!agentId) {
      return undefined
    }

    return store.agentStates[workspaceId]?.[agentId]
  })

  return {
    snapshot,
    activeAgentId,
    activeAgentState,
    error: computed(() => store.error),
    loading: computed(() => store.loading),
    open: () => store.openWorkspace(workspaceId),
    setActiveAgent: (agentId: string) => store.setActiveAgent(workspaceId, agentId),
    promptActiveAgent: (prompt: string, mode: PromptMode = "followup") => {
      const agentId = store.activeAgentIds[workspaceId]
      if (!agentId) {
        throw new Error("No runtime agent selected")
      }

      return store.promptAgent(workspaceId, agentId, prompt, mode)
    },
    pauseDispatch: () => store.pauseDispatch(workspaceId),
    startDispatch: (autoEnqueue = false) => store.startDispatch(workspaceId, autoEnqueue),
    updateModelPool: (modelPool: ModelPoolInput[]) => store.updateModelPool(workspaceId, modelPool),
    syncChallenges: () => store.syncChallenges(workspaceId),
    syncNotices: () => store.syncNotices(workspaceId),
    ensureEnvironmentAgent: () => store.ensureEnvironmentAgent(workspaceId),
    initializeRuntime: (pluginId: string, pluginConfig: RuntimeInitRequest["pluginConfig"]) =>
      store.initializeRuntime(workspaceId, { pluginId, pluginConfig }),
    enqueueChallenge: (challengeId: number) => store.enqueueChallenge(workspaceId, challengeId),
    disconnect: () => store.disconnectWorkspaceFeed(workspaceId),
  }
}
