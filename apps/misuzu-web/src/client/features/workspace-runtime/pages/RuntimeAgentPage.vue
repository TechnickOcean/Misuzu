<script setup lang="ts">
import { computed, ref, watch } from "vue"
import type { PromptMode } from "@shared/protocol.ts"
import { useRuntimeWorkspace } from "@/features/workspace-runtime/composables/use-runtime-workspace.ts"
import AgentChatPanel from "@/widgets/chat/AgentChatPanel.vue"

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

const activeAgentRank = computed(() => {
  const snapshot = runtime.snapshot.value
  if (!snapshot) {
    return undefined
  }

  return snapshot.challenges.find((c) => c.solverId === props.agentId)?.rank
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
  <div class="flex h-full min-h-0 flex-col">
    <AgentChatPanel
      :title="activeAgentName"
      :state="runtime.activeAgentState.value"
      :rank="activeAgentRank"
      :loading="sendingPrompt"
      @prompt="sendPrompt"
    />
  </div>
</template>
