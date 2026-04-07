import { computed } from "vue"
import type { PromptMode } from "@shared/protocol.ts"
import {
  usePromptSolverMutation,
  useSolverAgentStateQuery,
  useSolverWorkspaceQuery,
} from "@/shared/composables/workspace-requests.ts"
import { useAppServices } from "@/shared/di/app-services.ts"

const solverUnsubscribers = new Map<string, () => void>()

export function useSolverWorkspace(workspaceId: string) {
  const appServices = useAppServices()
  const solverWorkspaceQuery = useSolverWorkspaceQuery()
  const solverAgentStateQuery = useSolverAgentStateQuery()
  const promptSolverMutation = usePromptSolverMutation()

  solverWorkspaceQuery.paramsRef.value.workspaceId = workspaceId
  solverAgentStateQuery.paramsRef.value.workspaceId = workspaceId

  let feedConnected = false

  function connectWorkspaceFeed() {
    if (solverUnsubscribers.has(workspaceId)) {
      return
    }

    const unsubscribe = appServices.realtimeClient.connect(`solver:${workspaceId}`, (message) => {
      if (message.type === "solver.snapshot" && message.payload.workspaceId === workspaceId) {
        void solverWorkspaceQuery.refetch()
        return
      }

      if (message.type === "agent.event" && message.payload.workspaceId === workspaceId) {
        void solverAgentStateQuery.refetch()
      }
    })

    solverUnsubscribers.set(workspaceId, unsubscribe)
  }

  return {
    snapshot: computed(() => solverWorkspaceQuery.data.value),
    state: computed(() => solverAgentStateQuery.data.value),
    error: computed(() => solverWorkspaceQuery.error.value?.message ?? null),
    loading: computed(() => solverWorkspaceQuery.asyncStatus.value === "loading"),
    open: async () => {
      connectWorkspaceFeed()
      feedConnected = true
      await Promise.all([solverWorkspaceQuery.refetch(), solverAgentStateQuery.refetch()])
    },
    prompt: (prompt: string, mode: PromptMode = "followup") =>
      promptSolverMutation.mutateAsync({ workspaceId, prompt, mode }),
    disconnect: () => {
      if (!feedConnected) {
        return
      }

      solverUnsubscribers.get(workspaceId)?.()
      solverUnsubscribers.delete(workspaceId)
      feedConnected = false
    },
  }
}
