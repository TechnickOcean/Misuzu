import { computed, watch } from "vue"
import { useRouter } from "vue-router"
import type { WorkspaceRegistryEntry } from "@shared/protocol.ts"
import { useWorkspaceRegistryQuery } from "@/shared/composables/workspace-requests.ts"
import { useAppServices } from "@/shared/di/app-services.ts"

const registryUnsubscribers = new Set<() => void>()

export function useWorkspaceHomePage() {
  const router = useRouter()
  const appServices = useAppServices()

  const registryQuery = useWorkspaceRegistryQuery()
  const entries = computed(() => registryQuery.data.value ?? [])
  const loading = computed(() => registryQuery.asyncStatus.value === "loading")

  const runtimeCount = computed(
    () => entries.value.filter((entry) => entry.kind === "ctf-runtime").length,
  )
  const solverCount = computed(
    () => entries.value.filter((entry) => entry.kind === "solver").length,
  )
  const initializedRuntimeCount = computed(
    () =>
      entries.value.filter((entry) => entry.kind === "ctf-runtime" && entry.runtime?.initialized)
        .length,
  )
  const pendingRuntimeCount = computed(() => runtimeCount.value - initializedRuntimeCount.value)
  const latestWorkspace = computed(() => entries.value[0])

  function connectRegistryFeed() {
    if (registryUnsubscribers.size > 0) {
      return
    }

    const unsubscribe = appServices.realtimeClient.connect("registry", (message) => {
      if (message.type !== "registry.updated") {
        return
      }

      void registryQuery.refetch()
    })

    registryUnsubscribers.add(unsubscribe)
  }

  function disconnectRegistryFeed() {
    for (const unsubscribe of registryUnsubscribers) {
      unsubscribe()
    }
    registryUnsubscribers.clear()
  }

  watch(
    () => 0,
    (_, __, onCleanup) => {
      void registryQuery.refetch()
      connectRegistryFeed()
      onCleanup(() => {
        disconnectRegistryFeed()
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
    entries,
    loading,
    refreshEntries: () => registryQuery.refetch(),
    runtimeCount,
    solverCount,
    initializedRuntimeCount,
    pendingRuntimeCount,
    latestWorkspace,
    openWorkspace,
    openCreateWorkspace,
  }
}
