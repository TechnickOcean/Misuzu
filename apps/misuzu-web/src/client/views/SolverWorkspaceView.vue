<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue"
import { useRoute, useRouter } from "vue-router"
import { useSolverWorkspace } from "../composables/use-solver-workspace.ts"
import Button from "../components/ui/Button.vue"
import Card from "../components/ui/Card.vue"
import Badge from "../components/ui/Badge.vue"
import AgentChatPanel from "../components/workspace/AgentChatPanel.vue"

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
  <main class="solver-page">
    <header class="solver-page__header">
      <Button variant="ghost" @click="router.push('/')">← Home</Button>
      <div>
        <h1>Solver Workspace</h1>
        <p>{{ solver.snapshot.value?.rootDir ?? workspaceId }}</p>
      </div>
      <Badge tone="neutral">{{ solver.snapshot.value?.modelId ?? "No model" }}</Badge>
    </header>

    <Card class="solver-page__chat">
      <AgentChatPanel
        title="Standalone Solver Agent"
        :state="solver.state.value"
        :loading="sending"
        @prompt="sendPrompt"
      />
    </Card>
  </main>
</template>
