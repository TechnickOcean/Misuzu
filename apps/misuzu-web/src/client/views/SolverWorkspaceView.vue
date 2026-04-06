<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue"
import { useRoute, useRouter } from "vue-router"
import type { PromptMode } from "@shared/protocol.ts"
import PageHeading from "@/components/layout/PageHeading.vue"
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

async function sendPrompt(payload: { prompt: string; mode: PromptMode }) {
  sending.value = true
  try {
    await solver.prompt(payload.prompt, payload.mode)
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <PageHeading
      title="Solver Workspace"
      :description="solver.snapshot.value?.rootDir ?? workspaceId"
    >
      <template #actions>
        <Badge variant="secondary">{{ solver.snapshot.value?.modelId ?? "No model" }}</Badge>
        <Button variant="outline" @click="router.push({ name: 'workspace-create' })">New</Button>
      </template>
    </PageHeading>

    <Card class="min-h-[calc(100vh-12.5rem)] border-border/60 bg-card/70">
      <CardHeader>
        <CardTitle>Standalone Solver Agent</CardTitle>
      </CardHeader>
      <CardContent class="h-[calc(100%-4.25rem)] px-2 pb-4 md:px-3">
        <AgentChatPanel
          title="Standalone Solver Agent"
          :state="solver.state.value"
          :loading="sending"
          @prompt="sendPrompt"
        />
      </CardContent>
    </Card>
  </div>
</template>
