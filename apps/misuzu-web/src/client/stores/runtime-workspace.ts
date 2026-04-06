import { defineStore } from "pinia"
import type {
  AgentStateSnapshot,
  RuntimeInitRequest,
  RuntimeWorkspaceSnapshot,
} from "../../shared/protocol.ts"
import { useClientContainer } from "../di/container.ts"

const runtimeUnsubscribers = new Map<string, () => void>()
const agentRefreshTimers = new Map<string, number>()

export const useRuntimeWorkspaceStore = defineStore("runtime-workspace", {
  state: () => ({
    snapshots: {} as Record<string, RuntimeWorkspaceSnapshot>,
    agentStates: {} as Record<string, Record<string, AgentStateSnapshot>>,
    activeAgentIds: {} as Record<string, string>,
    loading: false,
    error: "" as string | null,
  }),
  actions: {
    async openWorkspace(workspaceId: string) {
      this.loading = true
      this.error = null

      try {
        const api = useClientContainer().getApiClient()
        const snapshot = await api.getRuntimeWorkspace(workspaceId)
        this.snapshots[workspaceId] = snapshot
        this.connectWorkspaceFeed(workspaceId)
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error)
      } finally {
        this.loading = false
      }
    },

    async initializeRuntime(workspaceId: string, request: RuntimeInitRequest) {
      const api = useClientContainer().getApiClient()
      const snapshot = await api.initializeRuntime(workspaceId, request)
      this.snapshots[workspaceId] = snapshot
      return snapshot
    },

    async ensureEnvironmentAgent(workspaceId: string) {
      const api = useClientContainer().getApiClient()
      const snapshot = await api.ensureRuntimeEnvironmentAgent(workspaceId)
      this.snapshots[workspaceId] = snapshot
      return snapshot
    },

    async pauseDispatch(workspaceId: string) {
      const api = useClientContainer().getApiClient()
      this.snapshots[workspaceId] = await api.pauseRuntimeDispatch(workspaceId)
    },

    async startDispatch(workspaceId: string, autoEnqueue = false) {
      const api = useClientContainer().getApiClient()
      this.snapshots[workspaceId] = await api.startRuntimeDispatch(workspaceId, { autoEnqueue })
    },

    async syncChallenges(workspaceId: string) {
      const api = useClientContainer().getApiClient()
      this.snapshots[workspaceId] = await api.syncRuntimeChallenges(workspaceId)
    },

    async syncNotices(workspaceId: string) {
      const api = useClientContainer().getApiClient()
      this.snapshots[workspaceId] = await api.syncRuntimeNotices(workspaceId)
    },

    async enqueueChallenge(workspaceId: string, challengeId: number) {
      const api = useClientContainer().getApiClient()
      this.snapshots[workspaceId] = await api.enqueueRuntimeChallenge(workspaceId, { challengeId })
    },

    async loadAgentState(workspaceId: string, agentId: string) {
      const api = useClientContainer().getApiClient()
      const state = await api.getRuntimeAgentState(workspaceId, agentId)

      if (!this.agentStates[workspaceId]) {
        this.agentStates[workspaceId] = {}
      }
      this.agentStates[workspaceId][agentId] = state
      return state
    },

    async promptAgent(workspaceId: string, agentId: string, prompt: string) {
      const api = useClientContainer().getApiClient()
      const state = await api.promptRuntimeAgent(workspaceId, agentId, prompt)

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

      const realtime = useClientContainer().getRealtimeClient()
      const unsubscribe = realtime.connect(`runtime:${workspaceId}`, (message) => {
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
      })

      runtimeUnsubscribers.set(workspaceId, unsubscribe)
    },

    disconnectWorkspaceFeed(workspaceId: string) {
      runtimeUnsubscribers.get(workspaceId)?.()
      runtimeUnsubscribers.delete(workspaceId)
    },
  },
})
