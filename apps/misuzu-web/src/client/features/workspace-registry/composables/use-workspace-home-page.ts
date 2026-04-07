import { computed, watch } from "vue"
import { useRouter } from "vue-router"
import type { WorkspaceRegistryEntry } from "@shared/protocol.ts"
import { useWorkspaceRegistryStore } from "@/features/workspace-registry/stores/workspace-registry-store.ts"
import { useAppServices } from "@/shared/di/app-services.ts"

export function useWorkspaceHomePage() {
  const router = useRouter()
  const appServices = useAppServices()

  const registryStore = useWorkspaceRegistryStore()
  registryStore.bindServices(appServices)

  const runtimeCount = computed(
    () => registryStore.entries.filter((entry) => entry.kind === "ctf-runtime").length,
  )
  const solverCount = computed(
    () => registryStore.entries.filter((entry) => entry.kind === "solver").length,
  )
  const initializedRuntimeCount = computed(
    () =>
      registryStore.entries.filter(
        (entry) => entry.kind === "ctf-runtime" && entry.runtime?.initialized,
      ).length,
  )
  const pendingRuntimeCount = computed(() => runtimeCount.value - initializedRuntimeCount.value)
  const latestWorkspace = computed(() => registryStore.entries[0])

  watch(
    () => 0,
    (_, __, onCleanup) => {
      void registryStore.loadEntries()
      registryStore.connectRegistryFeed()
      onCleanup(() => {
        registryStore.disconnectRegistryFeed()
      })
    },
    { immediate: true },
  )

  async function openWorkspace(workspaceId: string, kind: WorkspaceRegistryEntry["kind"]) {
    if (kind === "ctf-runtime") {
      await router.push({
        name: "runtime-overview",
        params: {
          id: workspaceId,
        },
      })
      return
    }

    await router.push({
      name: "solver",
      params: {
        id: workspaceId,
      },
    })
  }

  function openCreateWorkspace() {
    void router.push({ name: "workspace-create" })
  }

  return {
    registryStore,
    runtimeCount,
    solverCount,
    initializedRuntimeCount,
    pendingRuntimeCount,
    latestWorkspace,
    openWorkspace,
    openCreateWorkspace,
  }
}
