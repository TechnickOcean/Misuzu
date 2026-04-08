import { defineMutation, defineQuery, useMutation, useQuery } from "@pinia/colada"
import { ref } from "vue"
import type {
  RuntimeCreateRequest,
  SolverCreateRequest,
  WorkspaceDeleteRequest,
  WorkspaceRegistryEntry,
} from "@shared/protocol.ts"
import { useAppServices } from "@/shared/di/app-services.ts"

export const useWorkspaceRegistryQuery = defineQuery(() => {
  const { apiClient } = useAppServices()
  const paramsRef = ref({})

  const query = useQuery({
    key: () => ["workspace-registry", paramsRef.value],
    query: () => apiClient.listWorkspaces(),
  })

  return { paramsRef, ...query }
})

export const useCreateRuntimeWorkspaceMutation = defineMutation(() => {
  const { apiClient } = useAppServices()
  const workspaceRegistryQuery = useWorkspaceRegistryQuery()

  return useMutation({
    mutation: async (request: RuntimeCreateRequest) => {
      const snapshot = await apiClient.createRuntimeWorkspace(request)
      await workspaceRegistryQuery.refetch()
      return snapshot
    },
  })
})

export const useCreateSolverWorkspaceMutation = defineMutation(() => {
  const { apiClient } = useAppServices()
  const workspaceRegistryQuery = useWorkspaceRegistryQuery()

  return useMutation({
    mutation: async (request: SolverCreateRequest) => {
      const snapshot = await apiClient.createSolverWorkspace(request)
      await workspaceRegistryQuery.refetch()
      return snapshot
    },
  })
})

export const useDeleteWorkspaceMutation = defineMutation(() => {
  const { apiClient } = useAppServices()
  const workspaceRegistryQuery = useWorkspaceRegistryQuery()

  return useMutation({
    mutation: async ({
      workspaceId,
      request,
    }: {
      workspaceId: string
      request?: WorkspaceDeleteRequest
    }) => {
      const removed = await apiClient.deleteWorkspace(workspaceId, request)
      await workspaceRegistryQuery.refetch()
      return removed
    },
  })
})

export type WorkspaceRegistryQuery = ReturnType<typeof useWorkspaceRegistryQuery>
export type WorkspaceRegistryData = WorkspaceRegistryEntry[]
