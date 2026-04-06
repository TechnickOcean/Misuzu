<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from "vue"
import { useRoute, useRouter } from "vue-router"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useRuntimeWorkspace } from "@/composables/use-runtime-workspace.ts"

const route = useRoute()
const router = useRouter()

const workspaceId = String(route.params.id)
const runtime = useRuntimeWorkspace(workspaceId)

const summary = computed(() => runtime.snapshot.value)

onMounted(async () => {
  await runtime.open()

  const selectedAgentId =
    typeof route.params.agentId === "string" ? route.params.agentId : undefined
  if (selectedAgentId) {
    await runtime.setActiveAgent(selectedAgentId)
  }
})

onUnmounted(() => {
  runtime.disconnect()
})

watch(
  () => route.params.agentId,
  async (agentId) => {
    if (typeof agentId !== "string") {
      return
    }

    await runtime.setActiveAgent(agentId)
  },
)

function openOverview() {
  void router.push({
    name: "runtime-overview",
    params: { id: workspaceId },
  })
}

function openAgent(agentId: string) {
  void router.push({
    name: "runtime-agent",
    params: {
      id: workspaceId,
      agentId,
    },
  })
}
</script>

<template>
  <main class="min-h-screen space-y-4 p-4 md:p-6">
    <header
      class="flex flex-col gap-3 rounded-xl border border-border/60 bg-card/75 p-4 backdrop-blur"
    >
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="space-y-1">
          <Button variant="ghost" class="-ml-2 w-fit" @click="router.push({ name: 'home' })">
            ← Home
          </Button>
          <h1 class="text-2xl font-semibold tracking-tight">Runtime Workspace</h1>
          <p class="break-all text-xs text-muted-foreground">
            {{ summary?.rootDir ?? workspaceId }}
          </p>
        </div>

        <Badge :variant="summary?.paused ? 'destructive' : 'default'">
          {{ summary?.paused ? "Paused" : "Running" }}
        </Badge>
      </div>

      <div class="flex flex-wrap gap-2">
        <Button variant="outline" @click="runtime.syncChallenges">Sync Challenges</Button>
        <Button variant="outline" @click="runtime.syncNotices">Sync Notices</Button>
        <Button variant="outline" @click="runtime.ensureEnvironmentAgent"
          >Add Environment Agent</Button
        >
        <Button @click="runtime.startDispatch(true)">Start Flow</Button>
        <Button variant="destructive" @click="runtime.pauseDispatch">Pause Flow</Button>
        <Button variant="secondary" @click="openOverview">Overview</Button>
      </div>
    </header>

    <section class="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <Card class="bg-card/80">
        <CardHeader>
          <CardTitle class="text-sm uppercase tracking-wide text-muted-foreground"
            >Agents</CardTitle
          >
        </CardHeader>
        <CardContent class="space-y-3">
          <ScrollArea class="h-[260px] rounded-md border">
            <div class="grid gap-2 p-2">
              <Button
                v-for="agent in summary?.agents ?? []"
                :key="agent.id"
                :variant="route.params.agentId === agent.id ? 'default' : 'outline'"
                class="justify-between"
                @click="openAgent(agent.id)"
              >
                <span class="truncate">{{ agent.name }}</span>
                <Badge :variant="agent.role === 'environment' ? 'secondary' : 'outline'">
                  {{ agent.role }}
                </Badge>
              </Button>
            </div>
          </ScrollArea>

          <div class="space-y-2 rounded-md border p-3 text-xs text-muted-foreground">
            <p>Managed challenges: {{ summary?.challenges.length ?? 0 }}</p>
            <p>Pending tasks: {{ summary?.queue.pendingTaskCount ?? 0 }}</p>
            <p>Active solvers: {{ summary?.queue.busySolverCount ?? 0 }}</p>
          </div>
        </CardContent>
      </Card>

      <RouterView />
    </section>
  </main>
</template>
