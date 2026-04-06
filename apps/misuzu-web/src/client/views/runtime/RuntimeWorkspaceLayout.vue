<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from "vue"
import { useRoute, useRouter } from "vue-router"
import PageHeading from "@/components/layout/PageHeading.vue"
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

  const currentSnapshot = runtime.snapshot.value
  if (currentSnapshot && !currentSnapshot.initialized && !currentSnapshot.environmentAgentReady) {
    await runtime.ensureEnvironmentAgent()
  }

  const selectedAgentId =
    typeof route.params.agentId === "string" ? route.params.agentId : undefined
  if (selectedAgentId) {
    await runtime.setActiveAgent(selectedAgentId)
    return
  }

  const snapshot = runtime.snapshot.value
  if (snapshot && !snapshot.initialized && snapshot.environmentAgentReady) {
    await router.replace({
      name: "runtime-agent",
      params: {
        id: workspaceId,
        agentId: "environment",
      },
    })
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
  <div class="space-y-4">
    <PageHeading title="Runtime Workspace" :description="summary?.rootDir ?? workspaceId">
      <template #actions>
        <Badge :variant="summary?.paused ? 'destructive' : 'default'">
          {{ summary?.paused ? "Paused" : "Running" }}
        </Badge>
      </template>
    </PageHeading>

    <section class="flex flex-wrap gap-2 rounded-lg border border-border/60 bg-card p-3">
      <Button variant="outline" @click="runtime.syncChallenges">Sync Challenges</Button>
      <Button variant="outline" @click="runtime.syncNotices">Sync Notices</Button>
      <Button
        v-if="!summary?.initialized && !summary?.environmentAgentReady"
        variant="outline"
        @click="runtime.ensureEnvironmentAgent"
      >
        Add Environment Agent
      </Button>
      <Button @click="runtime.startDispatch(true)">Start Flow</Button>
      <Button variant="destructive" @click="runtime.pauseDispatch">Pause Flow</Button>
      <Button variant="secondary" @click="openOverview">Overview</Button>
    </section>

    <section class="grid gap-4 xl:grid-cols-[292px_minmax(0,1fr)]">
      <Card class="bg-card/80">
        <CardHeader>
          <CardTitle class="text-sm uppercase tracking-wide text-muted-foreground"
            >Agents</CardTitle
          >
        </CardHeader>
        <CardContent class="space-y-3 px-3 pb-3">
          <ScrollArea class="h-[260px] rounded-md border">
            <div class="grid gap-2 p-2 pr-3">
              <Button
                v-for="agent in summary?.agents ?? []"
                :key="agent.id"
                :variant="route.params.agentId === agent.id ? 'secondary' : 'ghost'"
                class="w-full min-w-0 justify-between border border-transparent px-2 text-foreground hover:text-foreground"
                :class="
                  route.params.agentId === agent.id
                    ? 'border-border bg-accent text-accent-foreground'
                    : 'text-muted-foreground'
                "
                @click="openAgent(agent.id)"
              >
                <span class="min-w-0 flex-1 truncate text-left">{{ agent.name }}</span>
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
  </div>
</template>
