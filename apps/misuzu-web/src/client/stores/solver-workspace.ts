import { defineStore } from "pinia"
import type { AgentStateSnapshot, SolverWorkspaceSnapshot } from "../../shared/protocol.ts"
import { useClientContainer } from "../di/container.ts"

const solverUnsubscribers = new Map<string, () => void>()

export const useSolverWorkspaceStore = defineStore("solver-workspace", {
  state: () => ({
    snapshots: {} as Record<string, SolverWorkspaceSnapshot>,
    agentStates: {} as Record<string, AgentStateSnapshot>,
    loading: false,
    error: "" as string | null,
  }),
  actions: {
    async openWorkspace(workspaceId: string) {
      this.loading = true
      this.error = null

      try {
        const api = useClientContainer().getApiClient()
        this.snapshots[workspaceId] = await api.getSolverWorkspace(workspaceId)
        this.agentStates[workspaceId] = await api.getSolverAgentState(workspaceId)
        this.connectWorkspaceFeed(workspaceId)
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error)
      } finally {
        this.loading = false
      }
    },

    async prompt(workspaceId: string, prompt: string) {
      const api = useClientContainer().getApiClient()
      this.agentStates[workspaceId] = await api.promptSolver(workspaceId, prompt)
      this.snapshots[workspaceId] = await api.getSolverWorkspace(workspaceId)
      return this.agentStates[workspaceId]
    },

    connectWorkspaceFeed(workspaceId: string) {
      if (solverUnsubscribers.has(workspaceId)) {
        return
      }

      const realtime = useClientContainer().getRealtimeClient()
      const unsubscribe = realtime.connect(`solver:${workspaceId}`, (message) => {
        if (message.type === "solver.snapshot" && message.payload.workspaceId === workspaceId) {
          this.snapshots[workspaceId] = message.payload.snapshot
          return
        }

        if (message.type === "agent.event" && message.payload.workspaceId === workspaceId) {
          void this.refreshAgentState(workspaceId)
        }
      })

      solverUnsubscribers.set(workspaceId, unsubscribe)
    },

    async refreshAgentState(workspaceId: string) {
      const api = useClientContainer().getApiClient()
      this.agentStates[workspaceId] = await api.getSolverAgentState(workspaceId)
      return this.agentStates[workspaceId]
    },

    disconnectWorkspaceFeed(workspaceId: string) {
      solverUnsubscribers.get(workspaceId)?.()
      solverUnsubscribers.delete(workspaceId)
    },
  },
})
