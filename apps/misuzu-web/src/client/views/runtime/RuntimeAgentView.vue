<script setup lang="ts">
import { computed, ref, watch } from "vue"
import type { PromptMode } from "@shared/protocol.ts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import AgentChatPanel from "@/components/workspace/AgentChatPanel.vue"
import { useRuntimeWorkspace } from "@/composables/use-runtime-workspace.ts"

const props = defineProps<{
  workspaceId: string
  agentId: string
}>()

const runtime = useRuntimeWorkspace(props.workspaceId)
const sendingPrompt = ref(false)

const activeAgentName = computed(() => {
  const snapshot = runtime.snapshot.value
  if (!snapshot) {
    return props.agentId
  }

  return snapshot.agents.find((agent) => agent.id === props.agentId)?.name ?? props.agentId
})

watch(
  () => props.agentId,
  async (agentId) => {
    await runtime.setActiveAgent(agentId)
  },
  { immediate: true },
)

async function sendPrompt(payload: { prompt: string; mode: PromptMode }) {
  sendingPrompt.value = true
  try {
    await runtime.promptActiveAgent(payload.prompt, payload.mode)
  } finally {
    sendingPrompt.value = false
  }
}
</script>

<template>
  <Card class="h-full min-h-[calc(100vh-12.5rem)] border-border/60 bg-card/70">
    <CardHeader class="pb-2">
      <CardTitle>{{ activeAgentName }}</CardTitle>
    </CardHeader>
    <CardContent class="h-[calc(100%-4.25rem)] px-2 pb-4 md:px-3">
      <AgentChatPanel
        :title="activeAgentName"
        :state="runtime.activeAgentState.value"
        :loading="sendingPrompt"
        @prompt="sendPrompt"
      />
    </CardContent>
  </Card>
</template>
