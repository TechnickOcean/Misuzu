<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue"
import { SendHorizontalIcon } from "lucide-vue-next"
import type { AgentMessagePart, AgentStateSnapshot, PromptMode } from "../../../shared/protocol.ts"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"

const MESSAGE_PAGE_SIZE = 30
const COLLAPSE_CHAR_THRESHOLD = 1200
const COLLAPSE_LINE_THRESHOLD = 24
const TOP_LOAD_THRESHOLD_PX = 24

const props = withDefaults(
  defineProps<{
    title: string
    state?: AgentStateSnapshot
    loading?: boolean
    compact?: boolean
    defaultPromptMode?: PromptMode
  }>(),
  {
    state: undefined,
    loading: false,
    compact: false,
    defaultPromptMode: "followup",
  },
)

const emit = defineEmits<{
  (event: "prompt", payload: { prompt: string; mode: PromptMode }): void
}>()

const promptInput = ref("")
const promptMode = ref<PromptMode>(props.defaultPromptMode)
const visibleMessageCount = ref(MESSAGE_PAGE_SIZE)
const scrollContainer = ref<HTMLElement>()
const loadingOlderMessages = ref(false)
const stickToBottom = ref(true)
let detachViewportListener: (() => void) | undefined

const allMessages = computed(() => props.state?.messages ?? [])
const hiddenMessageCount = computed(() =>
  Math.max(0, allMessages.value.length - visibleMessageCount.value),
)
const visibleMessages = computed(() => {
  if (visibleMessageCount.value >= allMessages.value.length) {
    return allMessages.value
  }

  return allMessages.value.slice(allMessages.value.length - visibleMessageCount.value)
})
const composerPlaceholder = computed(() =>
  promptMode.value === "steer"
    ? "Steer the currently running agent strategy..."
    : "Send a follow-up prompt...",
)

watch(
  () => props.defaultPromptMode,
  (mode) => {
    promptMode.value = mode
  },
)

function loadOlderMessages() {
  visibleMessageCount.value = Math.min(
    allMessages.value.length,
    visibleMessageCount.value + MESSAGE_PAGE_SIZE,
  )
}

function submitPrompt() {
  const prompt = promptInput.value.trim()
  if (!prompt) {
    return
  }

  emit("prompt", { prompt, mode: promptMode.value })
  promptInput.value = ""
}

function handleComposerKeydown(event: KeyboardEvent) {
  if (event.key !== "Enter" || event.shiftKey) {
    return
  }

  event.preventDefault()
  submitPrompt()
}

function roleLabel(role: string) {
  return role === "assistant"
    ? "Assistant"
    : role === "user"
      ? "You"
      : role === "system"
        ? "System"
        : role
}

function isUserRole(role: string) {
  return role === "user"
}

function messageParts(message: { text: string; parts?: AgentMessagePart[] }) {
  if (message.parts && message.parts.length > 0) {
    return message.parts
  }

  if (message.text) {
    return [{ kind: "text", text: message.text }] as AgentMessagePart[]
  }

  return [] as AgentMessagePart[]
}

function shouldCollapseMessage(text: string) {
  return text.length > COLLAPSE_CHAR_THRESHOLD || text.split("\n").length > COLLAPSE_LINE_THRESHOLD
}

function collapsedPreview(text: string) {
  const preview = text.split("\n").slice(0, 6).join("\n")
  return preview.length > 420 ? `${preview.slice(0, 420)}...` : preview
}

function getViewportElement() {
  const root = scrollContainer.value
  if (!root) {
    return undefined
  }

  const viewport = root.querySelector('[data-slot="scroll-area-viewport"]')
  return viewport instanceof HTMLElement ? viewport : undefined
}

function isNearBottom(viewport: HTMLElement) {
  const distanceToBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
  return distanceToBottom <= 80
}

function scrollToBottom() {
  const viewport = getViewportElement()
  if (!viewport) {
    return
  }

  viewport.scrollTop = viewport.scrollHeight
}

async function loadOlderMessagesFromTop(viewport: HTMLElement) {
  if (loadingOlderMessages.value || hiddenMessageCount.value <= 0) {
    return
  }

  loadingOlderMessages.value = true
  const previousHeight = viewport.scrollHeight
  const previousTop = viewport.scrollTop
  loadOlderMessages()

  await nextTick()
  viewport.scrollTop = viewport.scrollHeight - previousHeight + previousTop
  loadingOlderMessages.value = false
}

function onViewportScroll() {
  const viewport = getViewportElement()
  if (!viewport) {
    return
  }

  stickToBottom.value = isNearBottom(viewport)
  if (viewport.scrollTop <= TOP_LOAD_THRESHOLD_PX) {
    void loadOlderMessagesFromTop(viewport)
  }
}

function bindViewportListener() {
  detachViewportListener?.()
  const viewport = getViewportElement()
  if (!viewport) {
    return
  }

  viewport.addEventListener("scroll", onViewportScroll, { passive: true })
  detachViewportListener = () => {
    viewport.removeEventListener("scroll", onViewportScroll)
  }
}

onMounted(async () => {
  await nextTick()
  bindViewportListener()
  scrollToBottom()
})

onUnmounted(() => {
  detachViewportListener?.()
})

watch(scrollContainer, async () => {
  await nextTick()
  bindViewportListener()
})

watch(
  () => props.state,
  async (nextState, previousState) => {
    if (!nextState || nextState === previousState) {
      return
    }

    visibleMessageCount.value = MESSAGE_PAGE_SIZE
    stickToBottom.value = true
    await nextTick()
    bindViewportListener()
    scrollToBottom()
  },
)

watch(
  () => allMessages.value.length,
  async (nextCount, previousCount = 0) => {
    if (nextCount <= 0) {
      visibleMessageCount.value = MESSAGE_PAGE_SIZE
      return
    }

    if (nextCount < previousCount) {
      visibleMessageCount.value = Math.min(visibleMessageCount.value, nextCount)
    }

    if (!stickToBottom.value) {
      return
    }

    await nextTick()
    scrollToBottom()
  },
)
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <header class="flex flex-wrap items-center justify-between gap-2 px-1">
      <h3 class="text-base font-semibold">{{ title }}</h3>
      <Badge :variant="state?.isRunning ? 'destructive' : 'secondary'">
        {{ state?.isRunning ? "Running" : "Idle" }}
      </Badge>
    </header>

    <div class="mt-1 flex items-center justify-between px-1 text-xs text-muted-foreground">
      <span>Model: {{ state?.modelId ?? "Not selected" }}</span>
      <span>Messages: {{ state?.messages.length ?? 0 }}</span>
    </div>

    <div ref="scrollContainer" class="mt-3 min-h-0 flex-1">
      <ScrollArea class="h-full rounded-xl border bg-card/80 px-3 py-2">
        <div class="mx-auto grid w-full max-w-[72rem] gap-3 pb-6 pt-2">
          <div v-if="loadingOlderMessages" class="text-center text-xs text-muted-foreground">
            Loading older messages...
          </div>

          <div
            v-if="!state || state.messages.length === 0"
            class="mx-auto mt-8 grid w-full max-w-2xl gap-2 rounded-xl border border-dashed bg-muted/20 px-5 py-7 text-center"
          >
            <p class="text-sm font-medium">Empty holder</p>
            <p class="text-xs text-muted-foreground">
              {{
                !state
                  ? "Select an agent to open this conversation."
                  : "No messages yet. Start with a follow-up prompt or steer an active run."
              }}
            </p>
          </div>

          <article
            v-for="(message, index) in visibleMessages"
            :key="`${message.timestamp ?? `${message.role}-${index}`}`"
            class="grid"
            :class="isUserRole(message.role) ? 'justify-items-end' : 'justify-items-start'"
          >
            <div
              class="max-w-[96%] rounded-2xl border px-3 py-2 md:max-w-[88%]"
              :class="isUserRole(message.role) ? 'bg-primary/10' : 'bg-background/90'"
            >
              <header
                class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {{ roleLabel(message.role) }}
              </header>

              <p
                v-if="messageParts(message).length === 0"
                class="text-xs italic text-muted-foreground"
              >
                No text content.
              </p>

              <div class="space-y-2">
                <template v-for="(part, partIndex) in messageParts(message)" :key="partIndex">
                  <template v-if="part.kind === 'text'">
                    <template v-if="shouldCollapseMessage(part.text)">
                      <pre class="text-xs whitespace-pre-wrap break-all">{{
                        collapsedPreview(part.text)
                      }}</pre>
                      <details class="text-xs">
                        <summary class="cursor-pointer text-muted-foreground">
                          Show full content
                        </summary>
                        <pre class="mt-2 overflow-x-auto whitespace-pre-wrap break-all">{{
                          part.text
                        }}</pre>
                      </details>
                    </template>
                    <pre v-else class="overflow-x-auto whitespace-pre-wrap break-all text-xs">{{
                      part.text
                    }}</pre>
                  </template>

                  <div v-else class="space-y-2 rounded-md border bg-muted/30 p-2 text-xs">
                    <p class="font-medium">Tool · {{ part.name ?? part.toolType }}</p>

                    <div v-if="part.argsText">
                      <p class="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                        Arguments
                      </p>
                      <template v-if="shouldCollapseMessage(part.argsText)">
                        <pre class="whitespace-pre-wrap break-all">{{
                          collapsedPreview(part.argsText)
                        }}</pre>
                        <details>
                          <summary class="cursor-pointer text-muted-foreground">
                            Show full args
                          </summary>
                          <pre class="mt-2 overflow-x-auto whitespace-pre-wrap break-all">{{
                            part.argsText
                          }}</pre>
                        </details>
                      </template>
                      <pre v-else class="overflow-x-auto whitespace-pre-wrap break-all">{{
                        part.argsText
                      }}</pre>
                    </div>

                    <div v-if="part.resultText">
                      <p class="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                        Result
                      </p>
                      <template v-if="shouldCollapseMessage(part.resultText)">
                        <pre class="whitespace-pre-wrap break-all">{{
                          collapsedPreview(part.resultText)
                        }}</pre>
                        <details>
                          <summary class="cursor-pointer text-muted-foreground">
                            Show full result
                          </summary>
                          <pre class="mt-2 overflow-x-auto whitespace-pre-wrap break-all">{{
                            part.resultText
                          }}</pre>
                        </details>
                      </template>
                      <pre v-else class="overflow-x-auto whitespace-pre-wrap break-all">{{
                        part.resultText
                      }}</pre>
                    </div>
                  </div>
                </template>
              </div>
            </div>
          </article>
        </div>
      </ScrollArea>
    </div>

    <form
      class="sticky bottom-0 z-20 mt-3 border-t border-border/60 bg-background/95 pb-2 pt-3 backdrop-blur supports-[backdrop-filter]:bg-background/70"
      @submit.prevent="submitPrompt"
    >
      <div class="mx-auto w-full max-w-[72rem] px-1">
        <InputGroup class="h-auto rounded-2xl">
          <InputGroupTextarea
            v-model="promptInput"
            :rows="compact ? 2 : 4"
            class="max-h-64 min-h-24 border-0 text-sm"
            :placeholder="composerPlaceholder"
            :disabled="loading"
            @keydown="handleComposerKeydown"
          />

          <InputGroupAddon align="block-end" class="border-t">
            <div class="flex w-full flex-wrap items-center justify-between gap-2">
              <div class="flex items-center gap-1">
                <InputGroupButton
                  type="button"
                  size="sm"
                  :variant="promptMode === 'followup' ? 'secondary' : 'ghost'"
                  @click="promptMode = 'followup'"
                >
                  Followup
                </InputGroupButton>
                <InputGroupButton
                  type="button"
                  size="sm"
                  :variant="promptMode === 'steer' ? 'secondary' : 'ghost'"
                  @click="promptMode = 'steer'"
                >
                  Steer
                </InputGroupButton>
              </div>

              <InputGroupButton
                type="submit"
                size="sm"
                variant="default"
                :disabled="loading || !promptInput.trim()"
              >
                <SendHorizontalIcon class="size-4" />
                {{ loading ? "Sending..." : promptMode === "steer" ? "Steer" : "Send" }}
              </InputGroupButton>
            </div>
          </InputGroupAddon>
        </InputGroup>
      </div>
    </form>
  </div>
</template>
