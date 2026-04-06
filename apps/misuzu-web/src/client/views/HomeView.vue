<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue"
import { useRouter } from "vue-router"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import WorkspaceCard from "@/components/workspace/WorkspaceCard.vue"
import { useAppServices } from "@/di/app-services.ts"
import { useWorkspaceRegistryStore } from "@/stores/workspace-registry.ts"

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

onMounted(async () => {
  await registryStore.loadEntries()
  registryStore.connectRegistryFeed()
})

onUnmounted(() => {
  registryStore.disconnectRegistryFeed()
})

async function openWorkspace(workspaceId: string, kind: "ctf-runtime" | "solver") {
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
</script>

<template>
  <div class="space-y-6">
    <section
      class="grid gap-3 rounded-xl border border-border/60 bg-card p-4 sm:grid-cols-[1fr_auto] sm:items-center"
    >
      <div>
        <p class="text-sm font-semibold">Dashboard</p>
        <p class="text-xs text-muted-foreground">
          Workspace registry is persisted on the backend. Open any entry to continue where you left
          off.
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <Button variant="outline" @click="registryStore.loadEntries">Refresh</Button>
        <Button @click="router.push({ name: 'workspace-create' })">Create Workspace</Button>
      </div>
    </section>

    <section class="grid gap-3 md:grid-cols-3">
      <Card>
        <CardHeader class="pb-2">
          <CardDescription>Total Workspaces</CardDescription>
          <CardTitle class="text-3xl">{{ registryStore.entries.length }}</CardTitle>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader class="pb-2">
          <CardDescription>Runtime (Initialized / Pending)</CardDescription>
          <CardTitle class="text-3xl"
            >{{ initializedRuntimeCount }} / {{ pendingRuntimeCount }}</CardTitle
          >
        </CardHeader>
      </Card>
      <Card>
        <CardHeader class="pb-2">
          <CardDescription>Solver</CardDescription>
          <CardTitle class="text-3xl">{{ solverCount }}</CardTitle>
        </CardHeader>
      </Card>
    </section>

    <section class="grid gap-3 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle class="text-base">Latest Update</CardTitle>
        </CardHeader>
        <CardContent>
          <p v-if="latestWorkspace" class="text-sm">
            {{ latestWorkspace.name }} · {{ new Date(latestWorkspace.updatedAt).toLocaleString() }}
          </p>
          <p v-else class="text-sm text-muted-foreground">No workspace activity yet.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle class="text-base">Runtime Health</CardTitle>
        </CardHeader>
        <CardContent class="flex flex-wrap gap-2">
          <Badge variant="default">Initialized {{ initializedRuntimeCount }}</Badge>
          <Badge variant="outline">Pending {{ pendingRuntimeCount }}</Badge>
          <Badge variant="secondary">Solver Workspaces {{ solverCount }}</Badge>
        </CardContent>
      </Card>
    </section>

    <section>
      <Card>
        <CardHeader class="flex items-start justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <CardTitle>Workspace Registry</CardTitle>
            <CardDescription>Persisted entries restored from backend storage.</CardDescription>
          </div>
          <Badge variant="secondary">{{ registryStore.entries.length }} entries</Badge>
        </CardHeader>

        <CardContent class="space-y-3">
          <p v-if="registryStore.loading" class="text-sm text-muted-foreground">
            Loading workspace registry...
          </p>
          <p v-else-if="registryStore.entries.length === 0" class="text-sm text-muted-foreground">
            No workspace found. Start by creating one.
          </p>

          <div class="grid gap-3">
            <WorkspaceCard
              v-for="entry in registryStore.entries"
              :key="entry.id"
              :entry="entry"
              @open="openWorkspace"
            />
          </div>
        </CardContent>
      </Card>
    </section>
  </div>
</template>
