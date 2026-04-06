<script setup lang="ts">
import { ref } from "vue"
import type { AgentStateSnapshot } from "../../../shared/protocol.ts"
import Button from "../ui/Button.vue"
import Textarea from "../ui/Textarea.vue"
import Badge from "../ui/Badge.vue"

const props = withDefaults(
  defineProps<{
    title: string
    state?: AgentStateSnapshot
    loading?: boolean
    compact?: boolean
  }>(),
  {
    state: undefined,
    loading: false,
    compact: false,
  },
)

const emit = defineEmits<{
  (event: "prompt", prompt: string): void
}>()

const promptInput = ref("")

function submitPrompt() {
  const prompt = promptInput.value.trim()
  if (!prompt) {
    return
  }

  emit("prompt", prompt)
  promptInput.value = ""
}
</script>

<template>
  <div class="agent-chat" :class="{ 'agent-chat--compact': compact }">
    <header class="agent-chat__header">
      <h3>{{ title }}</h3>
      <Badge :tone="state?.isRunning ? 'warning' : 'neutral'">
        {{ state?.isRunning ? "Running" : "Idle" }}
      </Badge>
    </header>

    <div class="agent-chat__meta">
      <span>Model: {{ state?.modelId ?? "Not selected" }}</span>
      <span>Messages: {{ state?.messages.length ?? 0 }}</span>
    </div>

    <div class="agent-chat__messages">
      <p v-if="!state">Select an agent to inspect history.</p>
      <p v-else-if="state.messages.length === 0">No messages yet.</p>

      <article
        v-for="(message, index) in state?.messages ?? []"
        :key="`${message.timestamp ?? index}`"
      >
        <header>{{ message.role }}</header>
        <pre>{{ message.text || "(empty)" }}</pre>
      </article>
    </div>

    <form class="agent-chat__composer" @submit.prevent="submitPrompt">
      <Textarea
        v-model="promptInput"
        :rows="compact ? 3 : 4"
        placeholder="Send instructions to this agent..."
        :disabled="loading"
      />
      <Button type="submit" :disabled="loading || !promptInput.trim()">
        {{ loading ? "Sending..." : "Send" }}
      </Button>
    </form>
  </div>
</template>
