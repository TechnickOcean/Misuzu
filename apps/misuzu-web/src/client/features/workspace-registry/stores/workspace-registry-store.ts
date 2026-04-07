import { defineStore } from "pinia"
import type {
  RuntimeCreateRequest,
  SolverCreateRequest,
  WorkspaceRegistryEntry,
} from "@shared/protocol.ts"
import type { AppServices } from "@/shared/di/app-services.ts"

const registryUnsubscribers = new Set<() => void>()
let services: AppServices | undefined

function requireServices() {
  if (!services) {
    throw new Error("WorkspaceRegistryStore is not initialized with AppServices")
  }

  return services
}

export const useWorkspaceRegistryStore = defineStore("workspace-registry", {
  state: () => ({
    entries: [] as WorkspaceRegistryEntry[],
    loading: false,
    error: "" as string | null,
  }),
  actions: {
    bindServices(appServices: AppServices) {
      services = appServices
    },

    async loadEntries() {
      this.loading = true
      this.error = null

      try {
        this.entries = await requireServices().apiClient.listWorkspaces()
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error)
      } finally {
        this.loading = false
      }
    },

    async createRuntimeWorkspace(request: RuntimeCreateRequest) {
      const snapshot = await requireServices().apiClient.createRuntimeWorkspace(request)
      await this.loadEntries()
      return snapshot
    },

    async createSolverWorkspace(request: SolverCreateRequest) {
      const snapshot = await requireServices().apiClient.createSolverWorkspace(request)
      await this.loadEntries()
      return snapshot
    },

    connectRegistryFeed() {
      if (registryUnsubscribers.size > 0) {
        return
      }

      const unsubscribe = requireServices().realtimeClient.connect("registry", (message) => {
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
