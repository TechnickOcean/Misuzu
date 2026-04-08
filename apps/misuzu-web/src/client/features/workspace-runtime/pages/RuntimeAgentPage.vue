<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { marked } from "marked"
import type { PromptMode } from "@shared/protocol.ts"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useRuntimeWorkspace } from "@/features/workspace-runtime/composables/use-runtime-workspace.ts"
import AgentChatPanel from "@/widgets/chat/AgentChatPanel.vue"

const props = defineProps<{
  workspaceId: string
  agentId: string
}>()

const runtime = useRuntimeWorkspace(props.workspaceId)
const activeTab = ref("writeup")
const sendingPrompt = ref(false)
const promptError = ref("")
const writeupLoading = ref(false)
const writeupError = ref("")
const writeupExists = ref(false)
const writeupHtml = ref("")
const writeupChallengeTitle = ref("")

const activeAgentName = computed(() => {
  const snapshot = runtime.snapshot.value
  if (!snapshot) {
    return props.agentId
  }

  const challengeTitle = snapshot.challenges.find(
    (challenge) => challenge.solverId === props.agentId,
  )?.title
  if (challengeTitle) {
    return challengeTitle
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

const activeChallengeStatus = computed(() => {
  const snapshot = runtime.snapshot.value
  if (!snapshot) {
    return undefined
  }

  return snapshot.challenges.find((challenge) => challenge.solverId === props.agentId)?.status
})

const showSolvedTabs = computed(() => activeChallengeStatus.value === "solved")

watch(
  () => props.agentId,
  async (agentId) => {
    activeTab.value = "writeup"
    await runtime.setActiveAgent(agentId)

    if (showSolvedTabs.value) {
      await loadWriteup(agentId)
      return
    }

    writeupLoading.value = false
    writeupError.value = ""
    writeupExists.value = false
    writeupHtml.value = ""
    writeupChallengeTitle.value = ""
  },
  { immediate: true },
)

watch(
  () => showSolvedTabs.value,
  async (solved) => {
    if (!solved) {
      return
    }

    await loadWriteup(props.agentId)
  },
)

async function loadWriteup(agentId: string) {
  writeupLoading.value = true
  writeupError.value = ""
  writeupExists.value = false
  writeupHtml.value = ""
  writeupChallengeTitle.value = ""

  try {
    const writeup = await runtime.getAgentWriteup(agentId)
    writeupChallengeTitle.value = writeup.challengeTitle ?? ""
    writeupExists.value = writeup.exists

    if (!writeup.exists || !writeup.markdown.trim()) {
      return
    }

    writeupHtml.value = await marked.parse(writeup.markdown)
  } catch (error) {
    writeupError.value = error instanceof Error ? error.message : String(error)
  } finally {
    writeupLoading.value = false
  }
}

async function sendPrompt(payload: { prompt: string; mode: PromptMode }) {
  promptError.value = ""
  sendingPrompt.value = true
  try {
    await runtime.promptActiveAgent(payload.prompt, payload.mode)
  } catch (error) {
    promptError.value = error instanceof Error ? error.message : String(error)
  } finally {
    sendingPrompt.value = false
  }
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <p v-if="promptError" class="px-2 py-1 text-xs text-destructive">
      {{ promptError }}
    </p>

    <Tabs
      v-if="showSolvedTabs"
      v-model:model-value="activeTab"
      class="flex flex-col min-h-0 flex-1"
    >
      <div class="px-4 pt-3 flex-shrink-0">
        <TabsList
          class="w-full justify-start border-b rounded-none h-auto p-0 bg-transparent gap-6"
        >
          <TabsTrigger
            value="writeup"
            class="relative rounded-none border-b-2 border-transparent bg-transparent px-2 pb-2 pt-2 text-sm font-medium text-muted-foreground shadow-none transition-none data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none hover:text-foreground"
          >
            Writeup
          </TabsTrigger>
          <TabsTrigger
            value="chat"
            class="relative rounded-none border-b-2 border-transparent bg-transparent px-2 pb-2 pt-2 text-sm font-medium text-muted-foreground shadow-none transition-none data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none hover:text-foreground"
          >
            History
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent
        value="writeup"
        class="min-h-0 flex-1 overflow-y-auto outline-none mt-0 px-3 py-3 md:px-4"
      >
        <article class="max-w-4xl mx-auto rounded-lg border bg-card p-6 shadow-sm">
          <h3 class="text-xl font-semibold tracking-tight">
            {{ writeupChallengeTitle || activeAgentName }} Writeup
          </h3>
          <p class="mt-1.5 text-sm text-muted-foreground">
            Auto-loaded from solver workspace `WriteUp.md`.
          </p>

          <p v-if="writeupLoading" class="mt-6 text-sm text-muted-foreground animate-pulse">
            Loading writeup...
          </p>
          <p v-else-if="writeupError" class="mt-6 text-sm text-destructive">{{ writeupError }}</p>
          <p v-else-if="!writeupExists" class="mt-6 text-sm text-muted-foreground">
            WriteUp.md not found yet for this solver.
          </p>
          <div
            v-else
            class="prose dark:prose-invert max-w-none mt-6 text-xs prose-p:text-xs prose-li:text-xs prose-headings:text-sm prose-h1:text-base prose-h2:text-sm prose-h3:text-sm prose-code:text-[11px] prose-pre:text-[11px] prose-a:text-xs"
            v-html="writeupHtml"
          />
        </article>
      </TabsContent>

      <TabsContent
        value="chat"
        class="min-h-0 flex-1 overflow-hidden outline-none mt-0 px-3 py-3 md:px-4"
      >
        <AgentChatPanel
          :key="`${props.workspaceId}:${props.agentId}`"
          :title="activeAgentName"
          :state="runtime.activeAgentState.value"
          :rank="activeAgentRank"
          :loading="sendingPrompt"
          @prompt="sendPrompt"
        />
      </TabsContent>
    </Tabs>

    <div v-else class="min-h-0 flex-1 overflow-hidden px-3 py-3 md:px-4">
      <AgentChatPanel
        :key="`${props.workspaceId}:${props.agentId}`"
        :title="activeAgentName"
        :state="runtime.activeAgentState.value"
        :rank="activeAgentRank"
        :loading="sendingPrompt"
        @prompt="sendPrompt"
      />
    </div>
  </div>
</template>
