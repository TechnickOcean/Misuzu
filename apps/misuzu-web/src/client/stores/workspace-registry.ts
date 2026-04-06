import { defineStore } from "pinia"
import type {
  RuntimeCreateRequest,
  SolverCreateRequest,
  WorkspaceRegistryEntry,
} from "../../shared/protocol.ts"
import { useClientContainer } from "../di/container.ts"

const registryUnsubscribers = new Set<() => void>()

export const useWorkspaceRegistryStore = defineStore("workspace-registry", {
  state: () => ({
    entries: [] as WorkspaceRegistryEntry[],
    loading: false,
    error: "" as string | null,
  }),
  actions: {
    async loadEntries() {
      this.loading = true
      this.error = null

      try {
        const api = useClientContainer().getApiClient()
        this.entries = await api.listWorkspaces()
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error)
      } finally {
        this.loading = false
      }
    },

    async createRuntimeWorkspace(request: RuntimeCreateRequest) {
      const api = useClientContainer().getApiClient()
      const snapshot = await api.createRuntimeWorkspace(request)
      await this.loadEntries()
      return snapshot
    },

    async createSolverWorkspace(request: SolverCreateRequest) {
      const api = useClientContainer().getApiClient()
      const snapshot = await api.createSolverWorkspace(request)
      await this.loadEntries()
      return snapshot
    },

    connectRegistryFeed() {
      if (registryUnsubscribers.size > 0) {
        return
      }

      const realtime = useClientContainer().getRealtimeClient()
      const unsubscribe = realtime.connect("registry", (message) => {
        if (message.type !== "registry.updated") {
          return
        }

        this.entries = message.payload.entries
      })

      registryUnsubscribers.add(unsubscribe)
    },

    disconnectRegistryFeed() {
      for (const unsubscribe of registryUnsubscribers) {
        unsubscribe()
      }
      registryUnsubscribers.clear()
    },
  },
})
