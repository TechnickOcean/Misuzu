import { defineStore } from "pinia"
import type {
  AgentStateSnapshot,
  ModelPoolInput,
  PromptMode,
  RuntimeInitRequest,
  RuntimeWorkspaceSnapshot,
} from "../../shared/protocol.ts"
import type { AppServices } from "../di/app-services.ts"

const runtimeUnsubscribers = new Map<string, () => void>()
const agentRefreshTimers = new Map<string, number>()
let services: AppServices | undefined

function requireServices() {
  if (!services) {
    throw new Error("RuntimeWorkspaceStore is not initialized with AppServices")
  }

  return services
}

export const useRuntimeWorkspaceStore = defineStore("runtime-workspace", {
  state: () => ({
    snapshots: {} as Record<string, RuntimeWorkspaceSnapshot>,
    agentStates: {} as Record<string, Record<string, AgentStateSnapshot>>,
    activeAgentIds: {} as Record<string, string>,
    loading: false,
    error: "" as string | null,
  }),
  actions: {
    bindServices(appServices: AppServices) {
      services = appServices
    },

    async openWorkspace(workspaceId: string) {
      this.loading = true
      this.error = null

      try {
        const snapshot = await requireServices().apiClient.getRuntimeWorkspace(workspaceId)
        this.snapshots[workspaceId] = snapshot
        this.connectWorkspaceFeed(workspaceId)
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error)
      } finally {
        this.loading = false
      }
    },

    async initializeRuntime(workspaceId: string, request: RuntimeInitRequest) {
      const snapshot = await requireServices().apiClient.initializeRuntime(workspaceId, request)
      this.snapshots[workspaceId] = snapshot
      return snapshot
    },

    async ensureEnvironmentAgent(workspaceId: string) {
      const snapshot = await requireServices().apiClient.ensureRuntimeEnvironmentAgent(workspaceId)
      this.snapshots[workspaceId] = snapshot
      return snapshot
    },

    async pauseDispatch(workspaceId: string) {
      this.snapshots[workspaceId] =
        await requireServices().apiClient.pauseRuntimeDispatch(workspaceId)
    },

    async startDispatch(workspaceId: string, autoEnqueue = false) {
      this.snapshots[workspaceId] = await requireServices().apiClient.startRuntimeDispatch(
        workspaceId,
        {
          autoEnqueue,
        },
      )
    },

    async updateModelPool(workspaceId: string, modelPool: ModelPoolInput[]) {
      this.snapshots[workspaceId] = await requireServices().apiClient.updateRuntimeModelPool(
        workspaceId,
        { modelPool },
      )
    },

    async syncChallenges(workspaceId: string) {
      this.snapshots[workspaceId] =
        await requireServices().apiClient.syncRuntimeChallenges(workspaceId)
    },

    async syncNotices(workspaceId: string) {
      this.snapshots[workspaceId] =
        await requireServices().apiClient.syncRuntimeNotices(workspaceId)
    },

    async enqueueChallenge(workspaceId: string, challengeId: number) {
      this.snapshots[workspaceId] = await requireServices().apiClient.enqueueRuntimeChallenge(
        workspaceId,
        {
          challengeId,
        },
      )
    },

    async loadAgentState(workspaceId: string, agentId: string) {
      const state = await requireServices().apiClient.getRuntimeAgentState(workspaceId, agentId)

      if (!this.agentStates[workspaceId]) {
        this.agentStates[workspaceId] = {}
      }
      this.agentStates[workspaceId][agentId] = state
      return state
    },

    async promptAgent(
      workspaceId: string,
      agentId: string,
      prompt: string,
      mode: PromptMode = "followup",
    ) {
      const state = await requireServices().apiClient.promptRuntimeAgent(
        workspaceId,
        agentId,
        prompt,
        mode,
      )

      if (!this.agentStates[workspaceId]) {
        this.agentStates[workspaceId] = {}
      }
      this.agentStates[workspaceId][agentId] = state
      return state
    },

    async setActiveAgent(workspaceId: string, agentId: string) {
      this.activeAgentIds[workspaceId] = agentId
      await this.loadAgentState(workspaceId, agentId)
    },

    connectWorkspaceFeed(workspaceId: string) {
      if (runtimeUnsubscribers.has(workspaceId)) {
        return
      }

      const unsubscribe = requireServices().realtimeClient.connect(
        `runtime:${workspaceId}`,
        (message) => {
          if (message.type === "runtime.snapshot" && message.payload.workspaceId === workspaceId) {
            this.snapshots[workspaceId] = message.payload.snapshot
            return
          }

          if (message.type !== "agent.event" || message.payload.workspaceId !== workspaceId) {
            return
          }

          const refreshKey = `${workspaceId}:${message.payload.agentId}`
          window.clearTimeout(agentRefreshTimers.get(refreshKey))

          const timerId = window.setTimeout(() => {
            if (this.activeAgentIds[workspaceId] === message.payload.agentId) {
              void this.loadAgentState(workspaceId, message.payload.agentId)
            }
          }, 220)

          agentRefreshTimers.set(refreshKey, timerId)
        },
      )

      runtimeUnsubscribers.set(workspaceId, unsubscribe)
    },

    disconnectWorkspaceFeed(workspaceId: string) {
      runtimeUnsubscribers.get(workspaceId)?.()
      runtimeUnsubscribers.delete(workspaceId)
    },
  },
})
