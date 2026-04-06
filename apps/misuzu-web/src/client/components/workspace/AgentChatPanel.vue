<script setup lang="ts">
import { ref } from "vue"
import type { AgentStateSnapshot } from "../../../shared/protocol.ts"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"

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
  <div
    class="grid h-full grid-rows-[auto_auto_1fr_auto] gap-3"
    :class="{ 'min-h-[320px]': compact }"
  >
    <header class="flex items-center justify-between gap-2">
      <h3 class="text-base font-semibold">{{ title }}</h3>
      <Badge :variant="state?.isRunning ? 'destructive' : 'secondary'">
        {{ state?.isRunning ? "Running" : "Idle" }}
      </Badge>
    </header>

    <div class="flex items-center justify-between text-xs text-muted-foreground">
      <span>Model: {{ state?.modelId ?? "Not selected" }}</span>
      <span>Messages: {{ state?.messages.length ?? 0 }}</span>
    </div>

    <ScrollArea class="rounded-md border bg-card/80 p-3">
      <div class="grid gap-2">
        <p v-if="!state" class="text-sm text-muted-foreground">
          Select an agent to inspect history.
        </p>
        <p v-else-if="state.messages.length === 0" class="text-sm text-muted-foreground">
          No messages yet.
        </p>

        <article
          v-for="(message, index) in state?.messages ?? []"
          :key="`${message.timestamp ?? index}`"
          class="rounded-md border bg-background/90 p-2"
        >
          <header
            class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {{ message.role }}
          </header>
          <pre class="text-xs">{{ message.text || "(empty)" }}</pre>
        </article>
      </div>
    </ScrollArea>

    <form class="grid gap-2" @submit.prevent="submitPrompt">
      <Textarea
        v-model="promptInput"
        :rows="compact ? 2 : 4"
        class="min-h-20"
        placeholder="Send instructions to this agent..."
        :disabled="loading"
      />
      <Button type="submit" :disabled="loading || !promptInput.trim()" class="w-fit">
        {{ loading ? "Sending..." : "Send" }}
      </Button>
    </form>
  </div>
</template>
