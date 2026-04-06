<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { useRouter } from "vue-router"
import { marked } from "marked"
import type {
  ModelPoolInput,
  PluginCatalogItem,
  RuntimeCreateRequest,
} from "../../shared/protocol.ts"
import { useWorkspaceRegistryStore } from "../stores/workspace-registry.ts"
import { useClientContainer } from "../di/container.ts"
import Button from "../components/ui/Button.vue"
import Card from "../components/ui/Card.vue"
import Input from "../components/ui/Input.vue"
import Textarea from "../components/ui/Textarea.vue"
import Badge from "../components/ui/Badge.vue"
import WorkspaceCard from "../components/workspace/WorkspaceCard.vue"

const router = useRouter()
const registryStore = useWorkspaceRegistryStore()
const api = useClientContainer().getApiClient()

const createMode = ref<"runtime" | "solver">("runtime")
const creating = ref(false)
const createError = ref("")

const runtimeName = ref("")
const runtimeRootDir = ref("")
const runtimeWithPlugin = ref(true)
const runtimeAutoOrchestrate = ref(false)
const modelPoolJson = ref(
  '[\n  {\n    "provider": "openai",\n    "modelId": "gpt-4.1",\n    "maxConcurrency": 2\n  }\n]',
)
const pluginConfigJson = ref(
  '{\n  "baseUrl": "https://example.com",\n  "contest": { "mode": "auto" },\n  "auth": { "mode": "cookie", "cookie": "sid=..." }\n}',
)

const pluginQuery = ref("")
const plugins = ref<PluginCatalogItem[]>([])
const selectedPluginId = ref("")
const pluginReadmeHtml = ref("")

const solverName = ref("")
const solverRootDir = ref("")
const solverProvider = ref("openai")
const solverModelId = ref("gpt-4.1")

const selectedPlugin = computed(() =>
  plugins.value.find((plugin) => plugin.id === selectedPluginId.value),
)

onMounted(async () => {
  await registryStore.loadEntries()
  registryStore.connectRegistryFeed()
  await loadPlugins()
})

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

function parseModelPool() {
  const parsed = JSON.parse(modelPoolJson.value) as unknown
  if (!Array.isArray(parsed)) {
    throw new Error("modelPool must be an array")
  }

  return parsed as ModelPoolInput[]
}

async function createRuntimeWorkspace() {
  creating.value = true
  createError.value = ""

  try {
    const modelPool = parseModelPool()
    const snapshot = await registryStore.createRuntimeWorkspace({
      name: runtimeName.value,
      rootDir: runtimeRootDir.value,
      modelPool,
      pluginId: runtimeWithPlugin.value ? selectedPluginId.value : undefined,
      pluginConfig: runtimeWithPlugin.value
        ? (JSON.parse(pluginConfigJson.value) as NonNullable<RuntimeCreateRequest["pluginConfig"]>)
        : undefined,
      autoOrchestrate: runtimeAutoOrchestrate.value,
      createEnvironmentAgent: !runtimeWithPlugin.value,
    })

    await router.push(`/runtime/${snapshot.id}`)
  } catch (error) {
    createError.value = error instanceof Error ? error.message : String(error)
  } finally {
    creating.value = false
  }
}

async function createSolverWorkspace() {
  creating.value = true
  createError.value = ""

  try {
    const snapshot = await registryStore.createSolverWorkspace({
      name: solverName.value,
      rootDir: solverRootDir.value,
      model: {
        provider: solverProvider.value,
        modelId: solverModelId.value,
      },
    })

    await router.push(`/solver/${snapshot.id}`)
  } catch (error) {
    createError.value = error instanceof Error ? error.message : String(error)
  } finally {
    creating.value = false
  }
}

async function openWorkspace(workspaceId: string, kind: "ctf-runtime" | "solver") {
  if (kind === "ctf-runtime") {
    await router.push(`/runtime/${workspaceId}`)
    return
  }

  await router.push(`/solver/${workspaceId}`)
}
</script>

<template>
  <main class="home-page">
    <section class="home-page__hero">
      <h1>Misuzu Web Control Deck</h1>
      <p>
        Pick an existing workspace or launch a new runtime/solver flow with plugin onboarding, model
        pool tuning, and websocket state sync.
      </p>
    </section>

    <section class="home-page__grid">
      <Card class="home-page__panel">
        <header class="panel-header">
          <h2>Workspace Registry</h2>
          <Badge tone="neutral">{{ registryStore.entries.length }} entries</Badge>
        </header>

        <p v-if="registryStore.loading">Loading workspace registry...</p>
        <p v-else-if="registryStore.entries.length === 0">
          No workspace yet. Create one on the right.
        </p>

        <div class="registry-list">
          <WorkspaceCard
            v-for="entry in registryStore.entries"
            :key="entry.id"
            :entry="entry"
            @open="openWorkspace"
          />
        </div>
      </Card>

      <Card class="home-page__panel">
        <header class="panel-header">
          <h2>Create Workspace</h2>
          <div class="mode-switch">
            <Button
              :variant="createMode === 'runtime' ? 'default' : 'outline'"
              @click="createMode = 'runtime'"
            >
              Runtime
            </Button>
            <Button
              :variant="createMode === 'solver' ? 'default' : 'outline'"
              @click="createMode = 'solver'"
            >
              Solver
            </Button>
          </div>
        </header>

        <form
          v-if="createMode === 'runtime'"
          class="create-form"
          @submit.prevent="createRuntimeWorkspace"
        >
          <label>
            Runtime name
            <Input v-model="runtimeName" placeholder="optional display name" />
          </label>
          <label>
            Root dir
            <Input v-model="runtimeRootDir" placeholder="optional absolute path" />
          </label>

          <label class="inline-check">
            <input v-model="runtimeWithPlugin" type="checkbox" />
            Initialize platform plugin now
          </label>

          <label class="inline-check">
            <input v-model="runtimeAutoOrchestrate" type="checkbox" />
            Enable FIFO auto orchestration
          </label>

          <label>
            Model pool (JSON)
            <Textarea v-model="modelPoolJson" :rows="7" />
          </label>

          <template v-if="runtimeWithPlugin">
            <label>
              Search plugins
              <div class="inline-row">
                <Input v-model="pluginQuery" placeholder="search by id/name" />
                <Button type="button" variant="outline" @click="loadPlugins">Search</Button>
              </div>
            </label>

            <label>
              Plugin
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

            <article v-if="selectedPlugin" class="plugin-readme">
              <h3>{{ selectedPlugin.name }} README</h3>
              <div class="markdown" v-html="pluginReadmeHtml" />
            </article>

            <label>
              Plugin config (JSON)
              <Textarea v-model="pluginConfigJson" :rows="9" />
            </label>
          </template>

          <Button type="submit" :disabled="creating">
            {{ creating ? "Creating..." : "Create Runtime Workspace" }}
          </Button>
        </form>

        <form v-else class="create-form" @submit.prevent="createSolverWorkspace">
          <label>
            Solver name
            <Input v-model="solverName" placeholder="optional display name" />
          </label>
          <label>
            Root dir
            <Input v-model="solverRootDir" placeholder="optional absolute path" />
          </label>
          <label>
            Model provider
            <Input v-model="solverProvider" placeholder="openai" />
          </label>
          <label>
            Model id
            <Input v-model="solverModelId" placeholder="gpt-4.1" />
          </label>

          <Button type="submit" :disabled="creating">
            {{ creating ? "Creating..." : "Create Solver Workspace" }}
          </Button>
        </form>

        <p v-if="createError" class="error-text">{{ createError }}</p>
      </Card>
    </section>
  </main>
</template>
