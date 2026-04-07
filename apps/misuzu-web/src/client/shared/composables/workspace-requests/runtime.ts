import { defineMutation, defineQuery, useMutation, useQuery } from "@pinia/colada"
import { ref } from "vue"
import type {
  AgentStateSnapshot,
  PromptMode,
  ProviderCatalogItem,
  ProviderConfigEntry,
  RuntimeConfigUpdateRequest,
  RuntimeInitRequest,
  RuntimeModelPoolUpdateRequest,
  RuntimeWorkspaceSettingsSnapshot,
  RuntimeWorkspaceSnapshot,
} from "@shared/protocol.ts"
import {
  normalizeAgentId,
  normalizeWorkspaceId,
  type RuntimeAgentStateParams,
  type WorkspaceParams,
} from "./common.ts"
import { useAppServices } from "@/shared/di/app-services.ts"

interface ProviderCatalogParams {
  workspaceId: string
}

export const useRuntimeWorkspaceQuery = defineQuery(() => {
  const { apiClient } = useAppServices()
  const paramsRef = ref<WorkspaceParams>({ workspaceId: "" })

  const query = useQuery({
    key: () => ["runtime-workspace", normalizeWorkspaceId(paramsRef.value.workspaceId)],
    enabled: () => Boolean(normalizeWorkspaceId(paramsRef.value.workspaceId)),
    query: () => apiClient.getRuntimeWorkspace(normalizeWorkspaceId(paramsRef.value.workspaceId)),
  })

  return { paramsRef, ...query }
})

export const useRuntimeSettingsQuery = defineQuery(() => {
  const { apiClient } = useAppServices()
  const paramsRef = ref<WorkspaceParams>({ workspaceId: "" })

  const query = useQuery({
    key: () => ["runtime-settings", normalizeWorkspaceId(paramsRef.value.workspaceId)],
    enabled: () => Boolean(normalizeWorkspaceId(paramsRef.value.workspaceId)),
    query: () => apiClient.getRuntimeSettings(normalizeWorkspaceId(paramsRef.value.workspaceId)),
  })

  return { paramsRef, ...query }
})

export const useRuntimeAgentStateQuery = defineQuery(() => {
  const { apiClient } = useAppServices()
  const paramsRef = ref<RuntimeAgentStateParams>({ workspaceId: "", agentId: "" })

  const query = useQuery({
    key: () => [
      "runtime-agent-state",
      normalizeWorkspaceId(paramsRef.value.workspaceId),
      normalizeAgentId(paramsRef.value.agentId),
    ],
    enabled: () =>
      Boolean(normalizeWorkspaceId(paramsRef.value.workspaceId)) &&
      Boolean(normalizeAgentId(paramsRef.value.agentId)),
    query: () =>
      apiClient.getRuntimeAgentState(
        normalizeWorkspaceId(paramsRef.value.workspaceId),
        normalizeAgentId(paramsRef.value.agentId),
      ),
  })

  return { paramsRef, ...query }
})

export const useProviderCatalogQuery = defineQuery(() => {
  const { apiClient } = useAppServices()
  const paramsRef = ref<ProviderCatalogParams>({ workspaceId: "" })

  const query = useQuery({
    key: () => ["provider-catalog", normalizeWorkspaceId(paramsRef.value.workspaceId)],
    query: () => apiClient.listProviderCatalog(normalizeWorkspaceId(paramsRef.value.workspaceId)),
  })

  return { paramsRef, ...query }
})

function useRuntimeRefreshers() {
  const runtimeWorkspaceQuery = useRuntimeWorkspaceQuery()
  const runtimeSettingsQuery = useRuntimeSettingsQuery()
  const runtimeAgentStateQuery = useRuntimeAgentStateQuery()

  async function refreshRuntimeWorkspace(workspaceId: string) {
    runtimeWorkspaceQuery.paramsRef.value.workspaceId = workspaceId
    await runtimeWorkspaceQuery.refetch()
  }

  async function refreshRuntimeSettings(workspaceId: string) {
    runtimeSettingsQuery.paramsRef.value.workspaceId = workspaceId
    await runtimeSettingsQuery.refetch()
  }

  async function refreshRuntimeAgentState(workspaceId: string, agentId: string) {
    runtimeAgentStateQuery.paramsRef.value.workspaceId = workspaceId
    runtimeAgentStateQuery.paramsRef.value.agentId = agentId
    await runtimeAgentStateQuery.refetch()
  }

  return {
    refreshRuntimeWorkspace,
    refreshRuntimeSettings,
    refreshRuntimeAgentState,
  }
}

export const useInitializeRuntimeMutation = defineMutation(() => {
  const { apiClient } = useAppServices()
  const { refreshRuntimeWorkspace } = useRuntimeRefreshers()

  return useMutation({
    mutation: async ({
      workspaceId,
      request,
    }: {
      workspaceId: string
      request: RuntimeInitRequest
    }) => {
      const snapshot = await apiClient.initializeRuntime(workspaceId, request)
      await refreshRuntimeWorkspace(workspaceId)
      return snapshot
    },
  })
})

export const useEnsureRuntimeEnvironmentAgentMutation = defineMutation(() => {
  const { apiClient } = useAppServices()
  const { refreshRuntimeWorkspace } = useRuntimeRefreshers()

  return useMutation({
    mutation: async (workspaceId: string) => {
      const snapshot = await apiClient.ensureRuntimeEnvironmentAgent(workspaceId)
      await refreshRuntimeWorkspace(workspaceId)
      return snapshot
    },
  })
})

export const usePauseRuntimeDispatchMutation = defineMutation(() => {
  const { apiClient } = useAppServices()
  const { refreshRuntimeWorkspace } = useRuntimeRefreshers()

  return useMutation({
    mutation: async (workspaceId: string) => {
      const snapshot = await apiClient.pauseRuntimeDispatch(workspaceId)
      await refreshRuntimeWorkspace(workspaceId)
      return snapshot
    },
  })
})

export const useStartRuntimeDispatchMutation = defineMutation(() => {
  const { apiClient } = useAppServices()
  const { refreshRuntimeWorkspace } = useRuntimeRefreshers()

  return useMutation({
    mutation: async ({
      workspaceId,
      autoEnqueue,
    }: {
      workspaceId: string
      autoEnqueue: boolean
    }) => {
      const snapshot = await apiClient.startRuntimeDispatch(workspaceId, { autoEnqueue })
      await refreshRuntimeWorkspace(workspaceId)
      return snapshot
    },
  })
})

export const useUpdateRuntimeModelPoolMutation = defineMutation(() => {
  const { apiClient } = useAppServices()
  const { refreshRuntimeWorkspace } = useRuntimeRefreshers()

  return useMutation({
    mutation: async ({
      workspaceId,
      request,
    }: {
      workspaceId: string
      request: RuntimeModelPoolUpdateRequest
    }) => {
      const snapshot = await apiClient.updateRuntimeModelPool(workspaceId, request)
      await refreshRuntimeWorkspace(workspaceId)
      return snapshot
    },
  })
})

export const useSyncRuntimeChallengesMutation = defineMutation(() => {
  const { apiClient } = useAppServices()
  const { refreshRuntimeWorkspace } = useRuntimeRefreshers()

  return useMutation({
    mutation: async (workspaceId: string) => {
      const snapshot = await apiClient.syncRuntimeChallenges(workspaceId)
      await refreshRuntimeWorkspace(workspaceId)
      return snapshot
    },
  })
})

export const useSyncRuntimeNoticesMutation = defineMutation(() => {
  const { apiClient } = useAppServices()
  const { refreshRuntimeWorkspace } = useRuntimeRefreshers()

  return useMutation({
    mutation: async (workspaceId: string) => {
      const snapshot = await apiClient.syncRuntimeNotices(workspaceId)
      await refreshRuntimeWorkspace(workspaceId)
      return snapshot
    },
  })
})

export const useEnqueueRuntimeChallengeMutation = defineMutation(() => {
  const { apiClient } = useAppServices()
  const { refreshRuntimeWorkspace } = useRuntimeRefreshers()

  return useMutation({
    mutation: async ({
      workspaceId,
      challengeId,
    }: {
      workspaceId: string
      challengeId: number
    }) => {
      const snapshot = await apiClient.enqueueRuntimeChallenge(workspaceId, { challengeId })
      await refreshRuntimeWorkspace(workspaceId)
      return snapshot
    },
  })
})

export const useDequeueRuntimeChallengeMutation = defineMutation(() => {
  const { apiClient } = useAppServices()
  const { refreshRuntimeWorkspace } = useRuntimeRefreshers()

  return useMutation({
    mutation: async ({
      workspaceId,
      challengeId,
    }: {
      workspaceId: string
      challengeId: number
    }) => {
      const snapshot = await apiClient.dequeueRuntimeChallenge(workspaceId, challengeId)
      await refreshRuntimeWorkspace(workspaceId)
      return snapshot
    },
  })
})

export const useResetRuntimeSolverMutation = defineMutation(() => {
  const { apiClient } = useAppServices()
  const { refreshRuntimeWorkspace } = useRuntimeRefreshers()

  return useMutation({
    mutation: async ({
      workspaceId,
      challengeId,
    }: {
      workspaceId: string
      challengeId: number
    }) => {
      const snapshot = await apiClient.resetRuntimeSolver(workspaceId, challengeId)
      await refreshRuntimeWorkspace(workspaceId)
      return snapshot
    },
  })
})

export const useUpdateRuntimeProviderConfigMutation = defineMutation(() => {
  const { apiClient } = useAppServices()
  const { refreshRuntimeWorkspace, refreshRuntimeSettings } = useRuntimeRefreshers()

  return useMutation({
    mutation: async ({
      workspaceId,
      providerConfig,
    }: {
      workspaceId: string
      providerConfig: ProviderConfigEntry[]
    }) => {
      const snapshot = await apiClient.updateRuntimeProviderConfig(workspaceId, providerConfig)
      await Promise.all([refreshRuntimeWorkspace(workspaceId), refreshRuntimeSettings(workspaceId)])
      return snapshot
    },
  })
})

export const useUpdateRuntimeConfigMutation = defineMutation(() => {
  const { apiClient } = useAppServices()
  const { refreshRuntimeWorkspace, refreshRuntimeSettings } = useRuntimeRefreshers()

  return useMutation({
    mutation: async ({
      workspaceId,
      request,
    }: {
      workspaceId: string
      request: RuntimeConfigUpdateRequest
    }) => {
      const snapshot = await apiClient.updateRuntimeConfig(workspaceId, request)
      await Promise.all([refreshRuntimeWorkspace(workspaceId), refreshRuntimeSettings(workspaceId)])
      return snapshot
    },
  })
})

export const usePromptRuntimeAgentMutation = defineMutation(() => {
  const { apiClient } = useAppServices()
  const { refreshRuntimeAgentState } = useRuntimeRefreshers()

  return useMutation({
    mutation: async ({
      workspaceId,
      agentId,
      prompt,
      mode,
    }: {
      workspaceId: string
      agentId: string
      prompt: string
      mode: PromptMode
    }) => {
      const state = await apiClient.promptRuntimeAgent(workspaceId, agentId, prompt, mode)
      await refreshRuntimeAgentState(workspaceId, agentId)
      return state
    },
  })
})

export type RuntimeWorkspaceQuery = ReturnType<typeof useRuntimeWorkspaceQuery>
export type RuntimeSettingsQuery = ReturnType<typeof useRuntimeSettingsQuery>
export type RuntimeAgentStateQuery = ReturnType<typeof useRuntimeAgentStateQuery>
export type ProviderCatalogQuery = ReturnType<typeof useProviderCatalogQuery>

export type RuntimeWorkspaceData = RuntimeWorkspaceSnapshot
export type RuntimeSettingsData = RuntimeWorkspaceSettingsSnapshot
export type RuntimeAgentStateData = AgentStateSnapshot
export type ProviderCatalogData = ProviderCatalogItem[]
