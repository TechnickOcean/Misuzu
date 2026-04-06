<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue"
import { useRoute, useRouter } from "vue-router"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import AgentChatPanel from "@/components/workspace/AgentChatPanel.vue"
import { useSolverWorkspace } from "@/composables/use-solver-workspace.ts"

const route = useRoute()
const router = useRouter()

const workspaceId = String(route.params.id)
const solver = useSolverWorkspace(workspaceId)

const sending = ref(false)

onMounted(async () => {
  await solver.open()
})

onUnmounted(() => {
  solver.disconnect()
})

async function sendPrompt(prompt: string) {
  sending.value = true
  try {
    await solver.prompt(prompt)
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <main class="min-h-screen space-y-4 p-4 md:p-6">
    <header
      class="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card/75 p-4"
    >
      <div class="space-y-1">
        <Button variant="ghost" class="-ml-2 w-fit" @click="router.push({ name: 'home' })">
          ← Home
        </Button>
        <h1 class="text-2xl font-semibold tracking-tight">Solver Workspace</h1>
        <p class="break-all text-xs text-muted-foreground">
          {{ solver.snapshot.value?.rootDir ?? workspaceId }}
        </p>
      </div>

      <Badge variant="secondary">{{ solver.snapshot.value?.modelId ?? "No model" }}</Badge>
    </header>

    <Card class="min-h-[620px]">
      <CardHeader>
        <CardTitle>Standalone Solver Agent</CardTitle>
      </CardHeader>
      <CardContent class="h-[calc(100%-4rem)]">
        <AgentChatPanel
          title="Standalone Solver Agent"
          :state="solver.state.value"
          :loading="sending"
          @prompt="sendPrompt"
        />
      </CardContent>
    </Card>
  </main>
</template>
