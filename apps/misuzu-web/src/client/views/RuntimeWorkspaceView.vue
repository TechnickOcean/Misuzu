<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue"
import { useRoute, useRouter } from "vue-router"
import { marked } from "marked"
import type { PluginCatalogItem, RuntimeInitRequest } from "../../shared/protocol.ts"
import { useRuntimeWorkspace } from "../composables/use-runtime-workspace.ts"
import { useClientContainer } from "../di/container.ts"
import Button from "../components/ui/Button.vue"
import Card from "../components/ui/Card.vue"
import Input from "../components/ui/Input.vue"
import Textarea from "../components/ui/Textarea.vue"
import Badge from "../components/ui/Badge.vue"
import AgentChatPanel from "../components/workspace/AgentChatPanel.vue"

const route = useRoute()
const router = useRouter()

const workspaceId = String(route.params.id)
const runtime = useRuntimeWorkspace(workspaceId)
const api = useClientContainer().getApiClient()

const sendingPrompt = ref(false)
const initError = ref("")
const plugins = ref<PluginCatalogItem[]>([])
const pluginQuery = ref("")
const selectedPluginId = ref("")
const pluginReadmeHtml = ref("")
const pluginConfigJson = ref(
  '{\n  "baseUrl": "https://example.com",\n  "contest": { "mode": "auto" },\n  "auth": { "mode": "cookie", "cookie": "sid=..." }\n}',
)

const activeAgentName = computed(() => {
  const snapshot = runtime.snapshot.value
  const agentId = runtime.activeAgentId.value
  if (!snapshot || !agentId) {
    return "Runtime Agent"
  }

  return snapshot.agents.find((agent) => agent.id === agentId)?.name ?? agentId
})

onMounted(async () => {
  await runtime.open()
  await loadPlugins()

  const firstAgent = runtime.snapshot.value?.agents[0]?.id
  if (firstAgent) {
    await runtime.setActiveAgent(firstAgent)
  }
})

onUnmounted(() => {
  runtime.disconnect()
})

watch(
  () => runtime.snapshot.value?.agents,
  async (agents) => {
    if (!agents || agents.length === 0) {
      return
    }

    if (
      !runtime.activeAgentId.value ||
      !agents.some((agent) => agent.id === runtime.activeAgentId.value)
    ) {
      await runtime.setActiveAgent(agents[0].id)
    }
  },
)

async function loadPlugins() {
  plugins.value = await api.listPlugins(pluginQuery.value)
  if (!selectedPluginId.value && plugins.value.length > 0) {
    selectedPluginId.value = plugins.value[0].id
  }

  if (selectedPluginId.value) {
    await loadPluginReadme(selectedPluginId.value)
  }
}

async function loadPluginReadme(pluginId: string) {
  const readme = await api.getPluginReadme(pluginId)
  pluginReadmeHtml.value = await marked.parse(readme.markdown)
}

async function initializeRuntime() {
  initError.value = ""

  try {
    const pluginConfig = JSON.parse(pluginConfigJson.value) as RuntimeInitRequest["pluginConfig"]
    await runtime.initializeRuntime(selectedPluginId.value, pluginConfig)
    await runtime.syncChallenges()
  } catch (error) {
    initError.value = error instanceof Error ? error.message : String(error)
  }
}

async function sendPrompt(prompt: string) {
  sendingPrompt.value = true
  try {
    await runtime.promptActiveAgent(prompt)
  } finally {
    sendingPrompt.value = false
  }
}

async function ensureEnvironmentAgent() {
  await runtime.ensureEnvironmentAgent()
  await runtime.setActiveAgent("environment")
}
</script>

<template>
  <main class="runtime-page">
    <header class="runtime-page__header">
      <Button variant="ghost" @click="router.push('/')">← Home</Button>
      <div>
        <h1>Runtime Workspace</h1>
        <p>{{ runtime.snapshot.value?.rootDir ?? workspaceId }}</p>
      </div>
      <Badge :tone="runtime.snapshot.value?.paused ? 'warning' : 'success'">
        {{ runtime.snapshot.value?.paused ? "Paused" : "Running" }}
      </Badge>
    </header>

    <section class="runtime-page__controls">
      <Button variant="outline" @click="runtime.syncChallenges">Sync Challenges</Button>
      <Button variant="outline" @click="runtime.syncNotices">Sync Notices</Button>
      <Button variant="outline" @click="ensureEnvironmentAgent">Add Environment Agent</Button>
      <Button variant="default" @click="runtime.startDispatch(true)">Start Flow</Button>
      <Button variant="danger" @click="runtime.pauseDispatch">Pause Flow</Button>
    </section>

    <section class="runtime-page__stats">
      <Card>
        <h3>Challenges</h3>
        <p>{{ runtime.snapshot.value?.challenges.length ?? 0 }}</p>
      </Card>
      <Card>
        <h3>Pending Tasks</h3>
        <p>{{ runtime.snapshot.value?.queue.pendingTaskCount ?? 0 }}</p>
      </Card>
      <Card>
        <h3>Active Solvers</h3>
        <p>{{ runtime.snapshot.value?.queue.busySolverCount ?? 0 }}</p>
      </Card>
      <Card>
        <h3>Registered Solvers</h3>
        <p>{{ runtime.snapshot.value?.queue.registeredSolverCount ?? 0 }}</p>
      </Card>
    </section>

    <section
      v-if="runtime.snapshot.value && !runtime.snapshot.value.initialized"
      class="runtime-page__init-card"
    >
      <Card>
        <h2>Runtime Not Initialized</h2>
        <p>
          This workspace is in Environment mode. You can keep chatting with EnvironmentAgent, then
          initialize plugin runtime once adapter is ready.
        </p>

        <label>
          Search plugins
          <div class="inline-row">
            <Input v-model="pluginQuery" placeholder="plugin id/name" />
            <Button variant="outline" @click="loadPlugins">Search</Button>
          </div>
        </label>

        <label>
          Select plugin
          <select
            v-model="selectedPluginId"
            class="ui-select"
            @change="loadPluginReadme(selectedPluginId)"
          >
            <option v-for="plugin in plugins" :key="plugin.id" :value="plugin.id">
              {{ plugin.name }} ({{ plugin.id }})
            </option>
          </select>
        </label>

        <article class="plugin-readme">
          <div class="markdown" v-html="pluginReadmeHtml" />
        </article>

        <label>
          Plugin config (JSON)
          <Textarea v-model="pluginConfigJson" :rows="8" />
        </label>

        <Button @click="initializeRuntime">Initialize Runtime Plugin</Button>
        <p v-if="initError" class="error-text">{{ initError }}</p>
      </Card>
    </section>

    <section class="runtime-page__workspace" v-if="runtime.snapshot.value">
      <aside class="runtime-page__agents">
        <h2>Agents</h2>

        <button
          v-for="agent in runtime.snapshot.value.agents"
          :key="agent.id"
          class="agent-item"
          :class="{ 'agent-item--active': runtime.activeAgentId.value === agent.id }"
          @click="runtime.setActiveAgent(agent.id)"
        >
          <span>{{ agent.name }}</span>
          <Badge :tone="agent.role === 'environment' ? 'neutral' : 'success'">
            {{ agent.role }}
          </Badge>
        </button>

        <h3>Challenge FIFO</h3>
        <div class="challenge-list">
          <article
            v-for="challenge in runtime.snapshot.value.challenges"
            :key="challenge.challengeId"
          >
            <header>
              <strong>#{{ challenge.challengeId }}</strong>
              <Badge :tone="challenge.status === 'active' ? 'warning' : 'neutral'">
                {{ challenge.status }}
              </Badge>
            </header>
            <p>{{ challenge.title }}</p>
            <Button variant="ghost" @click="runtime.enqueueChallenge(challenge.challengeId)">
              Enqueue
            </Button>
          </article>
        </div>
      </aside>

      <Card class="runtime-page__chat">
        <AgentChatPanel
          :title="activeAgentName"
          :state="runtime.activeAgentState.value"
          :loading="sendingPrompt"
          @prompt="sendPrompt"
        />
      </Card>
    </section>
  </main>
</template>
