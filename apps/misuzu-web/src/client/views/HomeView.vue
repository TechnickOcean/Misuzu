<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue"
import { useRouter } from "vue-router"
import ThemeToggle from "@/components/ThemeToggle.vue"
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
  <main class="mx-auto min-h-screen w-full max-w-6xl space-y-10 px-4 py-8 md:px-6">
    <header class="flex items-center justify-between">
      <p class="text-sm font-semibold tracking-[0.22em]">MISUZU</p>

      <div class="flex items-center gap-2">
        <ThemeToggle />
        <Button @click="router.push({ name: 'workspace-create' })">New Workspace</Button>
      </div>
    </header>

    <section class="space-y-6">
      <h1 class="max-w-4xl text-4xl font-semibold leading-tight tracking-tight md:text-6xl">
        The command center for CTF runtime orchestration.
      </h1>
      <p class="max-w-2xl text-base text-muted-foreground md:text-lg">
        Launch runtime or solver workspaces, track persistent state, and control every agent stream
        from one monochrome console.
      </p>

      <div class="flex flex-wrap gap-3">
        <Button size="lg" @click="router.push({ name: 'workspace-create' })"
          >Create Workspace</Button
        >
        <Button variant="outline" size="lg" @click="registryStore.loadEntries"
          >Refresh Registry</Button
        >
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
          <CardDescription>Runtime</CardDescription>
          <CardTitle class="text-3xl">{{ runtimeCount }}</CardTitle>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader class="pb-2">
          <CardDescription>Solver</CardDescription>
          <CardTitle class="text-3xl">{{ solverCount }}</CardTitle>
        </CardHeader>
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
  </main>
</template>
