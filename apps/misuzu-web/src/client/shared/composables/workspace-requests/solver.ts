import { defineMutation, defineQuery, useMutation, useQuery } from "@pinia/colada"
import { ref } from "vue"
import type { AgentStateSnapshot, PromptMode, SolverWorkspaceSnapshot } from "@shared/protocol.ts"
import { normalizeWorkspaceId, type WorkspaceParams } from "./common.ts"
import { useAppServices } from "@/shared/di/app-services.ts"

export const useSolverWorkspaceQuery = defineQuery(() => {
  const { apiClient } = useAppServices()
  const paramsRef = ref<WorkspaceParams>({ workspaceId: "" })

  const query = useQuery({
    key: () => ["solver-workspace", normalizeWorkspaceId(paramsRef.value.workspaceId)],
    enabled: () => Boolean(normalizeWorkspaceId(paramsRef.value.workspaceId)),
    query: () => apiClient.getSolverWorkspace(normalizeWorkspaceId(paramsRef.value.workspaceId)),
  })

  return { paramsRef, ...query }
})

export const useSolverAgentStateQuery = defineQuery(() => {
  const { apiClient } = useAppServices()
  const paramsRef = ref<WorkspaceParams>({ workspaceId: "" })

  const query = useQuery({
    key: () => ["solver-agent-state", normalizeWorkspaceId(paramsRef.value.workspaceId)],
    enabled: () => Boolean(normalizeWorkspaceId(paramsRef.value.workspaceId)),
    query: () => apiClient.getSolverAgentState(normalizeWorkspaceId(paramsRef.value.workspaceId)),
  })

  return { paramsRef, ...query }
})

function useSolverRefreshers() {
  const solverWorkspaceQuery = useSolverWorkspaceQuery()
  const solverAgentStateQuery = useSolverAgentStateQuery()

  async function refreshSolverWorkspace(workspaceId: string) {
    solverWorkspaceQuery.paramsRef.value.workspaceId = workspaceId
    await solverWorkspaceQuery.refetch()
  }

  async function refreshSolverAgentState(workspaceId: string) {
    solverAgentStateQuery.paramsRef.value.workspaceId = workspaceId
    await solverAgentStateQuery.refetch()
  }

  return {
    refreshSolverWorkspace,
    refreshSolverAgentState,
  }
}

export const usePromptSolverMutation = defineMutation(() => {
  const { apiClient } = useAppServices()
  const { refreshSolverWorkspace, refreshSolverAgentState } = useSolverRefreshers()

  return useMutation({
    mutation: async ({
      workspaceId,
      prompt,
      mode,
    }: {
      workspaceId: string
      prompt: string
      mode: PromptMode
    }) => {
      const state = await apiClient.promptSolver(workspaceId, prompt, mode)
      await Promise.all([refreshSolverWorkspace(workspaceId), refreshSolverAgentState(workspaceId)])
      return state
    },
  })
})

export type SolverWorkspaceQuery = ReturnType<typeof useSolverWorkspaceQuery>
export type SolverAgentStateQuery = ReturnType<typeof useSolverAgentStateQuery>

export type SolverWorkspaceData = SolverWorkspaceSnapshot
export type SolverAgentStateData = AgentStateSnapshot
