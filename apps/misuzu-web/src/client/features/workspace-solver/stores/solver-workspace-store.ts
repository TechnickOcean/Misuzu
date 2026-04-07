import { defineStore } from "pinia"
import type { AgentStateSnapshot, PromptMode, SolverWorkspaceSnapshot } from "@shared/protocol.ts"
import type { AppServices } from "@/shared/di/app-services.ts"

const solverUnsubscribers = new Map<string, () => void>()
let services: AppServices | undefined

function requireServices() {
  if (!services) {
    throw new Error("SolverWorkspaceStore is not initialized with AppServices")
  }

  return services
}

export const useSolverWorkspaceStore = defineStore("solver-workspace", {
  state: () => ({
    snapshots: {} as Record<string, SolverWorkspaceSnapshot>,
    agentStates: {} as Record<string, AgentStateSnapshot>,
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
        this.snapshots[workspaceId] =
          await requireServices().apiClient.getSolverWorkspace(workspaceId)
        this.agentStates[workspaceId] =
          await requireServices().apiClient.getSolverAgentState(workspaceId)
        this.connectWorkspaceFeed(workspaceId)
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error)
      } finally {
        this.loading = false
      }
    },

    async prompt(workspaceId: string, prompt: string, mode: PromptMode = "followup") {
      this.agentStates[workspaceId] = await requireServices().apiClient.promptSolver(
        workspaceId,
        prompt,
        mode,
      )
      this.snapshots[workspaceId] =
        await requireServices().apiClient.getSolverWorkspace(workspaceId)
      return this.agentStates[workspaceId]
    },

    connectWorkspaceFeed(workspaceId: string) {
      if (solverUnsubscribers.has(workspaceId)) {
        return
      }

      const unsubscribe = requireServices().realtimeClient.connect(
        `solver:${workspaceId}`,
        (message) => {
          if (message.type === "solver.snapshot" && message.payload.workspaceId === workspaceId) {
            this.snapshots[workspaceId] = message.payload.snapshot
            return
          }

          if (message.type === "agent.event" && message.payload.workspaceId === workspaceId) {
            void this.refreshAgentState(workspaceId)
          }
        },
      )

      solverUnsubscribers.set(workspaceId, unsubscribe)
    },

    async refreshAgentState(workspaceId: string) {
      this.agentStates[workspaceId] =
        await requireServices().apiClient.getSolverAgentState(workspaceId)
      return this.agentStates[workspaceId]
    },

    disconnectWorkspaceFeed(workspaceId: string) {
      solverUnsubscribers.get(workspaceId)?.()
      solverUnsubscribers.delete(workspaceId)
    },
  },
})
