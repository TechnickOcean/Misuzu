<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue"
import { useRouter } from "vue-router"
import { marked } from "marked"
import type {
  ModelPoolInput,
  PluginCatalogItem,
  RuntimeCreateRequest,
} from "../../shared/protocol.ts"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import WorkspaceCard from "@/components/workspace/WorkspaceCard.vue"
import { useAppServices } from "@/di/app-services.ts"
import { useWorkspaceRegistryStore } from "@/stores/workspace-registry.ts"

const router = useRouter()
const registryStore = useWorkspaceRegistryStore()
const appServices = useAppServices()
const { apiClient } = appServices

registryStore.bindServices(appServices)

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

onUnmounted(() => {
  registryStore.disconnectRegistryFeed()
})

async function loadPlugins() {
  plugins.value = await apiClient.listPlugins(pluginQuery.value)

  if (!selectedPluginId.value && plugins.value.length > 0) {
    selectedPluginId.value = plugins.value[0].id
  }

  if (selectedPluginId.value) {
    await loadPluginReadme(selectedPluginId.value)
  }
}

async function loadPluginReadme(pluginId: string) {
  const readme = await apiClient.getPluginReadme(pluginId)
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

    await router.push({
      name: "runtime-overview",
      params: {
        id: snapshot.id,
      },
    })
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

    await router.push({
      name: "solver",
      params: {
        id: snapshot.id,
      },
    })
  } catch (error) {
    createError.value = error instanceof Error ? error.message : String(error)
  } finally {
    creating.value = false
  }
}

async function openWorkspace(workspaceId: string, kind: "ctf-runtime" | "solver") {
  if (kind === "ctf-runtime") {
    await router.push({
      name: "runtime-overview",
      params: {
        id: workspaceId,
      },
    })
    return
  }

  await router.push({
    name: "solver",
    params: {
      id: workspaceId,
    },
  })
}
</script>

<template>
  <main class="min-h-screen space-y-4 p-4 md:p-6">
    <section class="rounded-xl border border-border/60 bg-card/70 p-5 backdrop-blur">
      <h1 class="text-3xl font-semibold tracking-tight">Misuzu Web Control Deck</h1>
      <p class="mt-2 max-w-3xl text-sm text-muted-foreground">
        Create or restore runtime and solver workspaces, browse built-in plugin docs, and drive
        orchestration with realtime state sync.
      </p>
    </section>

    <section class="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
      <Card class="bg-card/80">
        <CardHeader class="flex items-center justify-between sm:flex-row">
          <div>
            <CardTitle>Workspace Registry</CardTitle>
            <CardDescription>Persistent registry restored from backend store.</CardDescription>
          </div>
          <Badge variant="secondary">{{ registryStore.entries.length }} entries</Badge>
        </CardHeader>
        <CardContent class="space-y-3">
          <p v-if="registryStore.loading" class="text-sm text-muted-foreground">
            Loading workspace registry...
          </p>
          <p v-else-if="registryStore.entries.length === 0" class="text-sm text-muted-foreground">
            No workspace yet. Create one on the right.
          </p>

          <div class="grid gap-3">
            <WorkspaceCard
              v-for="entry in registryStore.entries"
              :key="entry.id"
              :entry="entry"
              @open="openWorkspace"
            />
          </div>
        </CardContent>
      </Card>

      <Card class="bg-card/80">
        <CardHeader>
          <CardTitle>Create Workspace</CardTitle>
          <CardDescription>
            Runtime supports plugin/no-plugin bootstrap. Solver is standalone chat workspace.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs v-model:model-value="createMode" class="space-y-4">
            <TabsList class="grid w-full grid-cols-2">
              <TabsTrigger value="runtime">Runtime</TabsTrigger>
              <TabsTrigger value="solver">Solver</TabsTrigger>
            </TabsList>

            <TabsContent value="runtime" class="space-y-4">
              <form class="space-y-4" @submit.prevent="createRuntimeWorkspace">
                <div class="space-y-2">
                  <label class="text-sm font-medium">Runtime name</label>
                  <Input v-model="runtimeName" placeholder="optional display name" />
                </div>

                <div class="space-y-2">
                  <label class="text-sm font-medium">Root directory</label>
                  <Input v-model="runtimeRootDir" placeholder="optional absolute path" />
                </div>

                <div class="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <p class="text-sm font-medium">Initialize platform plugin now</p>
                    <p class="text-xs text-muted-foreground">
                      Disable for EnvironmentAgent-first flow.
                    </p>
                  </div>
                  <Switch
                    :checked="runtimeWithPlugin"
                    @update:checked="(checked) => (runtimeWithPlugin = Boolean(checked))"
                  />
                </div>

                <div class="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <p class="text-sm font-medium">Enable FIFO auto orchestration</p>
                    <p class="text-xs text-muted-foreground">
                      Automatically enqueue all synced challenges.
                    </p>
                  </div>
                  <Switch
                    :checked="runtimeAutoOrchestrate"
                    @update:checked="(checked) => (runtimeAutoOrchestrate = Boolean(checked))"
                  />
                </div>

                <div class="space-y-2">
                  <label class="text-sm font-medium">Model pool JSON</label>
                  <Textarea v-model="modelPoolJson" :rows="7" class="font-mono text-xs" />
                </div>

                <template v-if="runtimeWithPlugin">
                  <div class="space-y-2">
                    <label class="text-sm font-medium">Search plugins</label>
                    <div class="flex gap-2">
                      <Input v-model="pluginQuery" placeholder="search by id/name" />
                      <Button type="button" variant="outline" @click="loadPlugins">Search</Button>
                    </div>
                  </div>

                  <div class="space-y-2">
                    <label class="text-sm font-medium">Plugin</label>
                    <Select v-model="selectedPluginId">
                      <SelectTrigger class="w-full">
                        <SelectValue placeholder="Select plugin" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem v-for="plugin in plugins" :key="plugin.id" :value="plugin.id">
                          {{ plugin.name }} ({{ plugin.id }})
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      v-if="selectedPluginId"
                      type="button"
                      variant="secondary"
                      class="w-fit"
                      @click="loadPluginReadme(selectedPluginId)"
                    >
                      Refresh README
                    </Button>
                  </div>

                  <article v-if="selectedPlugin" class="rounded-md border bg-muted/30 p-3">
                    <h3 class="mb-2 text-sm font-medium">{{ selectedPlugin.name }} README</h3>
                    <div class="markdown-content text-sm" v-html="pluginReadmeHtml" />
                  </article>

                  <div class="space-y-2">
                    <label class="text-sm font-medium">Plugin config JSON</label>
                    <Textarea v-model="pluginConfigJson" :rows="9" class="font-mono text-xs" />
                  </div>
                </template>

                <Button type="submit" :disabled="creating" class="w-full">
                  {{ creating ? "Creating..." : "Create Runtime Workspace" }}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="solver" class="space-y-4">
              <form class="space-y-4" @submit.prevent="createSolverWorkspace">
                <div class="space-y-2">
                  <label class="text-sm font-medium">Solver name</label>
                  <Input v-model="solverName" placeholder="optional display name" />
                </div>

                <div class="space-y-2">
                  <label class="text-sm font-medium">Root directory</label>
                  <Input v-model="solverRootDir" placeholder="optional absolute path" />
                </div>

                <div class="space-y-2">
                  <label class="text-sm font-medium">Model provider</label>
                  <Input v-model="solverProvider" placeholder="openai" />
                </div>

                <div class="space-y-2">
                  <label class="text-sm font-medium">Model id</label>
                  <Input v-model="solverModelId" placeholder="gpt-4.1" />
                </div>

                <Button type="submit" :disabled="creating" class="w-full">
                  {{ creating ? "Creating..." : "Create Solver Workspace" }}
                </Button>
              </form>
            </TabsContent>
          </Tabs>

          <p v-if="createError" class="mt-3 text-sm text-destructive">{{ createError }}</p>
        </CardContent>
      </Card>
    </section>
  </main>
</template>
