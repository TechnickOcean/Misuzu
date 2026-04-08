<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue"
import { SendHorizontalIcon } from "lucide-vue-next"
import type { AgentMessagePart, AgentStateSnapshot, PromptMode } from "@shared/protocol.ts"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import EmptyPlaceholder from "@/components/ui/empty-placeholder/EmptyPlaceholder.vue"
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
const ANSI_TOKEN_PATTERN = /\[([0-9;]{1,16})m/g

interface AnsiStyleState {
  foreground?: number
  bold: boolean
  dim: boolean
}

const props = withDefaults(
  defineProps<{
    title: string
    state?: AgentStateSnapshot
    rank?: number
    loading?: boolean
    compact?: boolean
    defaultPromptMode?: PromptMode
  }>(),
  {
    state: undefined,
    rank: undefined,
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
const currentAgentKey = computed(() => props.state?.agentId ?? props.title)
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

function renderAnsiHtml(text: string) {
  const styleState: AnsiStyleState = {
    bold: false,
    dim: false,
  }

  let html = ""
  let cursor = 0

  ANSI_TOKEN_PATTERN.lastIndex = 0
  for (const match of text.matchAll(ANSI_TOKEN_PATTERN)) {
    const marker = match[0]
    const markerIndex = match.index ?? -1
    if (markerIndex < 0) {
      continue
    }

    if (markerIndex > cursor) {
      html += wrapAnsiChunk(text.slice(cursor, markerIndex), styleState)
    }

    applyAnsiCodes(styleState, marker.slice(marker.indexOf("[") + 1, -1))
    cursor = markerIndex + marker.length
  }

  if (cursor < text.length) {
    html += wrapAnsiChunk(text.slice(cursor), styleState)
  }

  return html.length > 0 ? html : escapeHtml(text)
}

function wrapAnsiChunk(chunk: string, styleState: AnsiStyleState) {
  const escapedChunk = escapeHtml(chunk)
  if (escapedChunk.length === 0) {
    return ""
  }

  const classes = resolveAnsiClasses(styleState)
  if (classes.length === 0) {
    return escapedChunk
  }

  return `<span class="${classes.join(" ")}">${escapedChunk}</span>`
}

function applyAnsiCodes(styleState: AnsiStyleState, codeList: string) {
  const codes = codeList
    .split(";")
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value))

  if (codes.length === 0) {
    resetAnsiState(styleState)
    return
  }

  for (const code of codes) {
    if (code === 0) {
      resetAnsiState(styleState)
      continue
    }

    if (code === 1) {
      styleState.bold = true
      continue
    }

    if (code === 2) {
      styleState.dim = true
      continue
    }

    if (code === 22) {
      styleState.bold = false
      styleState.dim = false
      continue
    }

    if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
      styleState.foreground = code
      continue
    }

    if (code === 39) {
      styleState.foreground = undefined
    }
  }
}

function resetAnsiState(styleState: AnsiStyleState) {
  styleState.foreground = undefined
  styleState.bold = false
  styleState.dim = false
}

function resolveAnsiClasses(styleState: AnsiStyleState) {
  const classes: string[] = []

  if (styleState.bold) {
    classes.push("font-semibold")
  }

  if (styleState.dim) {
    classes.push("opacity-70")
  }

  if (styleState.foreground !== undefined) {
    classes.push(...ansiForegroundClasses(styleState.foreground))
  }

  return classes
}

function ansiForegroundClasses(code: number) {
  switch (code) {
    case 30:
      return ["text-zinc-800", "dark:text-zinc-200"]
    case 31:
      return ["text-red-600", "dark:text-red-400"]
    case 32:
      return ["text-emerald-600", "dark:text-emerald-400"]
    case 33:
      return ["text-amber-600", "dark:text-amber-300"]
    case 34:
      return ["text-blue-600", "dark:text-blue-400"]
    case 35:
      return ["text-fuchsia-600", "dark:text-fuchsia-400"]
    case 36:
      return ["text-cyan-600", "dark:text-cyan-400"]
    case 37:
      return ["text-slate-700", "dark:text-slate-200"]
    case 90:
      return ["text-zinc-500", "dark:text-zinc-400"]
    case 91:
      return ["text-red-500", "dark:text-red-300"]
    case 92:
      return ["text-emerald-500", "dark:text-emerald-300"]
    case 93:
      return ["text-amber-500", "dark:text-amber-300"]
    case 94:
      return ["text-blue-500", "dark:text-blue-300"]
    case 95:
      return ["text-fuchsia-500", "dark:text-fuchsia-300"]
    case 96:
      return ["text-cyan-500", "dark:text-cyan-300"]
    case 97:
      return ["text-zinc-50", "dark:text-zinc-50"]
    default:
      return []
  }
}

function escapeHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
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

function waitForAnimationFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

async function scrollToBottomSoon(retries = 3) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    await nextTick()
    await waitForAnimationFrame()
    scrollToBottom()
  }
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
  await scrollToBottomSoon()
})

onUnmounted(() => {
  detachViewportListener?.()
})

watch(scrollContainer, async () => {
  await nextTick()
  bindViewportListener()
  await scrollToBottomSoon(2)
})

watch(
  () => currentAgentKey.value,
  async (nextAgentKey, previousAgentKey) => {
    if (!nextAgentKey || nextAgentKey === previousAgentKey) {
      return
    }

    visibleMessageCount.value = MESSAGE_PAGE_SIZE
    stickToBottom.value = true
    await nextTick()
    bindViewportListener()
    await scrollToBottomSoon()
  },
  { immediate: true },
)

watch(
  () => props.state,
  async (nextState) => {
    if (!nextState) {
      return
    }

    if (nextState.messages.length === 0) {
      visibleMessageCount.value = MESSAGE_PAGE_SIZE
      stickToBottom.value = true
      await nextTick()
      bindViewportListener()
      await scrollToBottomSoon()
    }
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

    await scrollToBottomSoon(2)
  },
)
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
    <div
      class="mx-auto flex w-full items-center justify-between px-1 pt-1 text-xs text-muted-foreground xl:max-w-[50vw]"
    >
      <div class="flex items-center gap-4">
        <span>Model: {{ state?.modelId ?? "Not selected" }}</span>
        <span v-if="typeof rank === 'number'">Rank: {{ Math.round(rank) }}</span>
      </div>
      <span>Messages: {{ state?.messages.length ?? 0 }}</span>
    </div>

    <div ref="scrollContainer" class="min-h-0 flex-1 overflow-hidden">
      <ScrollArea class="h-full bg-card px-3 py-2 shadow-sm">
        <div class="mx-auto grid w-full gap-3 pb-3 pt-2 text-left xl:max-w-[50vw]">
          <div v-if="loadingOlderMessages" class="space-y-4 px-3 py-2">
            <div class="flex flex-col gap-2">
              <Skeleton class="h-4 w-[150px]" />
              <Skeleton class="h-20 w-full rounded-2xl" />
            </div>
            <div class="flex flex-col gap-2">
              <Skeleton class="h-4 w-[150px]" />
              <Skeleton class="h-16 w-[80%] rounded-2xl" />
            </div>
          </div>

          <EmptyPlaceholder
            v-if="!state || state.messages.length === 0"
            title="Empty holder"
            :description="
              !state
                ? 'Select an agent to open this conversation.'
                : 'No messages yet. Start with a follow-up prompt or steer an active run.'
            "
          />

          <article
            v-for="(message, index) in visibleMessages"
            :key="`${message.timestamp ?? `${message.role}-${index}`}`"
            class="grid justify-items-start"
          >
            <div
              class="w-full max-w-full rounded-2xl border px-3 py-2"
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
                      <pre
                        class="text-xs whitespace-pre-wrap break-all"
                        v-html="renderAnsiHtml(collapsedPreview(part.text))"
                      />
                      <details class="text-xs">
                        <summary class="cursor-pointer text-muted-foreground">
                          Show full content
                        </summary>
                        <pre
                          class="mt-2 overflow-x-auto whitespace-pre-wrap break-all"
                          v-html="renderAnsiHtml(part.text)"
                        />
                      </details>
                    </template>
                    <pre
                      v-else
                      class="overflow-x-auto whitespace-pre-wrap break-all text-xs"
                      v-html="renderAnsiHtml(part.text)"
                    />
                  </template>

                  <div v-else class="space-y-2 rounded-md border bg-muted/30 p-2 text-xs">
                    <p class="font-medium">Tool · {{ part.name ?? part.toolType }}</p>

                    <div v-if="part.argsText">
                      <p class="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                        Arguments
                      </p>
                      <template v-if="shouldCollapseMessage(part.argsText)">
                        <pre
                          class="whitespace-pre-wrap break-all"
                          v-html="renderAnsiHtml(collapsedPreview(part.argsText))"
                        />
                        <details>
                          <summary class="cursor-pointer text-muted-foreground">
                            Show full args
                          </summary>
                          <pre
                            class="mt-2 overflow-x-auto whitespace-pre-wrap break-all"
                            v-html="renderAnsiHtml(part.argsText)"
                          />
                        </details>
                      </template>
                      <pre
                        v-else
                        class="overflow-x-auto whitespace-pre-wrap break-all"
                        v-html="renderAnsiHtml(part.argsText)"
                      />
                    </div>

                    <div v-if="part.resultText">
                      <p class="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                        Result
                      </p>
                      <template v-if="shouldCollapseMessage(part.resultText)">
                        <pre
                          class="whitespace-pre-wrap break-all"
                          v-html="renderAnsiHtml(collapsedPreview(part.resultText))"
                        />
                        <details>
                          <summary class="cursor-pointer text-muted-foreground">
                            Show full result
                          </summary>
                          <pre
                            class="mt-2 overflow-x-auto whitespace-pre-wrap break-all"
                            v-html="renderAnsiHtml(part.resultText)"
                          />
                        </details>
                      </template>
                      <pre
                        v-else
                        class="overflow-x-auto whitespace-pre-wrap break-all"
                        v-html="renderAnsiHtml(part.resultText)"
                      />
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
      class="sticky bottom-0 z-10 mx-auto w-full shrink-0 pb-2 xl:max-w-[50vw]"
      @submit.prevent="submitPrompt"
    >
      <div
        class="mx-auto w-full rounded-2xl border border-border/80 bg-background/95 p-2 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/85"
      >
        <InputGroup class="h-auto rounded-xl bg-card/95">
          <InputGroupTextarea
            v-model="promptInput"
            :rows="compact ? 1 : 2"
            class="max-h-44 min-h-14 border-0 text-sm"
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
