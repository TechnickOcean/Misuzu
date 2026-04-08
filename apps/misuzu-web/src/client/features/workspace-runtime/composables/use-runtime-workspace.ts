import { computed, ref } from "vue"
import type {
  ModelPoolInput,
  PromptMode,
  ProviderConfigEntry,
  RuntimeConfigUpdateRequest,
  RuntimeInitRequest,
} from "@shared/protocol.ts"
import {
  useDequeueRuntimeChallengeMutation,
  useEnqueueRuntimeChallengeMutation,
  useEnsureRuntimeEnvironmentAgentMutation,
  useInitializeRuntimeMutation,
  usePauseRuntimeDispatchMutation,
  usePromptRuntimeAgentMutation,
  useResetRuntimeSolverMutation,
  useRuntimeAgentStateQuery,
  useRuntimeWorkspaceQuery,
  useStartRuntimeDispatchMutation,
  useSyncRuntimeChallengesMutation,
  useSyncRuntimeNoticesMutation,
  useUpdateRuntimeConfigMutation,
  useUpdateRuntimeModelPoolMutation,
  useUpdateRuntimeProviderConfigMutation,
} from "@/shared/composables/workspace-requests.ts"
import { useAppServices } from "@/shared/di/app-services.ts"

const runtimeUnsubscribers = new Map<string, () => void>()
const agentRefreshTimers = new Map<string, number>()
const snapshotRefreshTimers = new Map<string, number>()
const activeAgentIds = ref<Record<string, string>>({})

export function useRuntimeWorkspace(workspaceId: string) {
  const appServices = useAppServices()
  const runtimeWorkspaceQuery = useRuntimeWorkspaceQuery()
  const runtimeAgentStateQuery = useRuntimeAgentStateQuery()

  runtimeWorkspaceQuery.paramsRef.value.workspaceId = workspaceId

  const initializeRuntimeMutation = useInitializeRuntimeMutation()
  const ensureRuntimeEnvironmentAgentMutation = useEnsureRuntimeEnvironmentAgentMutation()
  const pauseRuntimeDispatchMutation = usePauseRuntimeDispatchMutation()
  const startRuntimeDispatchMutation = useStartRuntimeDispatchMutation()
  const updateRuntimeModelPoolMutation = useUpdateRuntimeModelPoolMutation()
  const syncRuntimeChallengesMutation = useSyncRuntimeChallengesMutation()
  const syncRuntimeNoticesMutation = useSyncRuntimeNoticesMutation()
  const enqueueRuntimeChallengeMutation = useEnqueueRuntimeChallengeMutation()
  const dequeueRuntimeChallengeMutation = useDequeueRuntimeChallengeMutation()
  const resetRuntimeSolverMutation = useResetRuntimeSolverMutation()
  const updateRuntimeProviderConfigMutation = useUpdateRuntimeProviderConfigMutation()
  const updateRuntimeConfigMutation = useUpdateRuntimeConfigMutation()
  const promptRuntimeAgentMutation = usePromptRuntimeAgentMutation()

  const snapshot = computed(() => runtimeWorkspaceQuery.data.value)
  const activeAgentId = computed(() => activeAgentIds.value[workspaceId])
  const activeAgentState = computed(() => {
    if (!activeAgentId.value) {
      return undefined
    }

    const state = runtimeAgentStateQuery.data.value
    if (state && state.agentId !== activeAgentId.value) {
      return undefined
    }

    return state
  })

  let feedConnected = false

  function connectWorkspaceFeed() {
    if (runtimeUnsubscribers.has(workspaceId)) {
      return
    }

    const unsubscribe = appServices.realtimeClient.connect(`runtime:${workspaceId}`, (message) => {
      if (message.type === "runtime.snapshot" && message.payload.workspaceId === workspaceId) {
        void runtimeWorkspaceQuery.refetch()
        return
      }

      if (message.type !== "agent.event" || message.payload.workspaceId !== workspaceId) {
        return
      }

      const refreshKey = `${workspaceId}:${message.payload.agentId}`
      window.clearTimeout(agentRefreshTimers.get(refreshKey))
      window.clearTimeout(snapshotRefreshTimers.get(workspaceId))

      const timerId = window.setTimeout(() => {
        if (activeAgentId.value === message.payload.agentId) {
          void runtimeAgentStateQuery.refetch()
        }
      }, 220)

      const snapshotTimerId = window.setTimeout(() => {
        void runtimeWorkspaceQuery.refetch()
      }, 220)

      agentRefreshTimers.set(refreshKey, timerId)
      snapshotRefreshTimers.set(workspaceId, snapshotTimerId)
    })

    runtimeUnsubscribers.set(workspaceId, unsubscribe)
  }

  return {
    snapshot,
    activeAgentId,
    activeAgentState,
    error: computed(() => runtimeWorkspaceQuery.error.value?.message ?? null),
    loading: computed(() => runtimeWorkspaceQuery.asyncStatus.value === "loading"),
    open: async () => {
      connectWorkspaceFeed()
      feedConnected = true
      await runtimeWorkspaceQuery.refetch()
    },
    setActiveAgent: async (agentId: string) => {
      activeAgentIds.value[workspaceId] = agentId
      runtimeAgentStateQuery.paramsRef.value.workspaceId = workspaceId
      runtimeAgentStateQuery.paramsRef.value.agentId = agentId
      await runtimeAgentStateQuery.refetch()
    },
    promptActiveAgent: (prompt: string, mode: PromptMode = "followup") => {
      const agentId = activeAgentId.value
      if (!agentId) {
        throw new Error("No runtime agent selected")
      }

      return promptRuntimeAgentMutation.mutateAsync({ workspaceId, agentId, prompt, mode })
    },
    pauseDispatch: () => pauseRuntimeDispatchMutation.mutateAsync(workspaceId),
    startDispatch: (autoEnqueue = false) =>
      startRuntimeDispatchMutation.mutateAsync({ workspaceId, autoEnqueue }),
    updateModelPool: (modelPool: ModelPoolInput[]) =>
      updateRuntimeModelPoolMutation.mutateAsync({
        workspaceId,
        request: { modelPool },
      }),
    syncChallenges: () => syncRuntimeChallengesMutation.mutateAsync(workspaceId),
    syncNotices: () => syncRuntimeNoticesMutation.mutateAsync(workspaceId),
    ensureEnvironmentAgent: () => ensureRuntimeEnvironmentAgentMutation.mutateAsync(workspaceId),
    initializeRuntime: (pluginId: string, pluginConfig: RuntimeInitRequest["pluginConfig"]) =>
      initializeRuntimeMutation.mutateAsync({
        workspaceId,
        request: { pluginId, pluginConfig },
      }),
    enqueueChallenge: (challengeId: number) =>
      enqueueRuntimeChallengeMutation.mutateAsync({ workspaceId, challengeId }),
    dequeueChallenge: (challengeId: number) =>
      dequeueRuntimeChallengeMutation.mutateAsync({ workspaceId, challengeId }),
    resetSolver: (challengeId: number) =>
      resetRuntimeSolverMutation.mutateAsync({ workspaceId, challengeId }),
    updateProviderConfig: (providerConfig: ProviderConfigEntry[]) =>
      updateRuntimeProviderConfigMutation.mutateAsync({ workspaceId, providerConfig }),
    updateRuntimeConfig: (request: RuntimeConfigUpdateRequest) =>
      updateRuntimeConfigMutation.mutateAsync({ workspaceId, request }),
    disconnect: () => {
      if (!feedConnected) {
        return
      }

      runtimeUnsubscribers.get(workspaceId)?.()
      runtimeUnsubscribers.delete(workspaceId)
      window.clearTimeout(snapshotRefreshTimers.get(workspaceId))
      snapshotRefreshTimers.delete(workspaceId)
      feedConnected = false
    },
  }
}
