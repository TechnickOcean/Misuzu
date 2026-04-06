<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue"
import { marked } from "marked"
import { useRouter } from "vue-router"
import type { PluginCatalogItem } from "@shared/protocol.ts"
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
import { Separator } from "@/components/ui/separator"
import { useRuntimeWorkspace } from "@/composables/use-runtime-workspace.ts"
import {
  createDefaultPluginConfigDraft,
  toPluginConfig,
  type AuthMode,
  type ContestMode,
  type PluginConfigDraft,
} from "@/composables/plugin-config-form.ts"
import { useAppServices } from "@/di/app-services.ts"

const props = defineProps<{
  workspaceId: string
}>()

const router = useRouter()
const runtime = useRuntimeWorkspace(props.workspaceId)
const { apiClient } = useAppServices()

const plugins = ref<PluginCatalogItem[]>([])
const pluginQuery = ref("")
const selectedPluginId = ref("")
const pluginReadmeHtml = ref("")
const pluginDraft = reactive<PluginConfigDraft>(createDefaultPluginConfigDraft())
const initError = ref("")

const snapshot = computed(() => runtime.snapshot.value)

onMounted(async () => {
  await loadPlugins()
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

async function initializeRuntime() {
  initError.value = ""

  try {
    if (!selectedPluginId.value) {
      throw new Error("Please select a plugin")
    }

    await runtime.initializeRuntime(selectedPluginId.value, toPluginConfig(pluginDraft))
    await runtime.syncChallenges()
  } catch (error) {
    initError.value = error instanceof Error ? error.message : String(error)
  }
}

function openSolverAgent(agentId: string) {
  void router.push({
    name: "runtime-agent",
    params: {
      id: props.workspaceId,
      agentId,
    },
  })
}

function setContestMode(value: string) {
  pluginDraft.contestMode = value as ContestMode
}

function setAuthMode(value: string) {
  pluginDraft.authMode = value as AuthMode
}
</script>

<template>
  <div class="grid gap-4">
    <section class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <Card>
        <CardHeader class="pb-2">
          <CardDescription>Challenges</CardDescription>
          <CardTitle class="text-2xl">{{ snapshot?.challenges.length ?? 0 }}</CardTitle>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader class="pb-2">
          <CardDescription>Pending</CardDescription>
          <CardTitle class="text-2xl">{{ snapshot?.queue.pendingTaskCount ?? 0 }}</CardTitle>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader class="pb-2">
          <CardDescription>Busy Solvers</CardDescription>
          <CardTitle class="text-2xl">{{ snapshot?.queue.busySolverCount ?? 0 }}</CardTitle>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader class="pb-2">
          <CardDescription>Idle Solvers</CardDescription>
          <CardTitle class="text-2xl">{{ snapshot?.queue.idleSolverCount ?? 0 }}</CardTitle>
        </CardHeader>
      </Card>
    </section>

    <Card v-if="snapshot && !snapshot.initialized">
      <CardHeader>
        <CardTitle>Initialize Runtime Plugin</CardTitle>
        <CardDescription>
          Runtime is in no-plugin mode. Configure adapter credentials below and bootstrap platform
          sync.
        </CardDescription>
      </CardHeader>
      <CardContent class="grid gap-4">
        <div class="flex gap-2">
          <Input v-model="pluginQuery" placeholder="search plugin by id/name" />
          <Button variant="outline" @click="loadPlugins">Search</Button>
        </div>

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
          variant="secondary"
          class="w-fit"
          @click="loadPluginReadme(selectedPluginId)"
        >
          Refresh README
        </Button>

        <article class="rounded-md border bg-muted/30 p-3">
          <div class="markdown-content text-sm" v-html="pluginReadmeHtml" />
        </article>

        <div class="grid gap-4 md:grid-cols-2">
          <div class="grid gap-2 md:col-span-2">
            <label class="text-sm font-medium">Base URL</label>
            <Input v-model="pluginDraft.baseUrl" placeholder="https://ctf.example.com" />
          </div>

          <div class="grid gap-2">
            <label class="text-sm font-medium">Contest Mode</label>
            <Select :model-value="pluginDraft.contestMode" @update:model-value="setContestMode">
              <SelectTrigger class="w-full">
                <SelectValue placeholder="Select contest mode" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">auto</SelectItem>
                <SelectItem value="id">id</SelectItem>
                <SelectItem value="title">title</SelectItem>
                <SelectItem value="url">url</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div v-if="pluginDraft.contestMode !== 'auto'" class="grid gap-2">
            <label class="text-sm font-medium">Contest Value</label>
            <Input
              v-model="pluginDraft.contestValue"
              :placeholder="pluginDraft.contestMode === 'id' ? '12345' : 'contest value'"
            />
          </div>

          <div class="grid gap-2 md:col-span-2">
            <label class="text-sm font-medium">Auth Mode</label>
            <Select :model-value="pluginDraft.authMode" @update:model-value="setAuthMode">
              <SelectTrigger class="w-full">
                <SelectValue placeholder="Select auth mode" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">manual</SelectItem>
                <SelectItem value="cookie">cookie</SelectItem>
                <SelectItem value="token">token</SelectItem>
                <SelectItem value="credentials">credentials</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div v-if="pluginDraft.authMode === 'cookie'" class="grid gap-2 md:col-span-2">
            <label class="text-sm font-medium">Cookie</label>
            <Input v-model="pluginDraft.cookie" placeholder="sid=..." />
          </div>

          <div v-if="pluginDraft.authMode === 'token'" class="grid gap-2 md:col-span-2">
            <label class="text-sm font-medium">Bearer Token</label>
            <Input v-model="pluginDraft.bearerToken" placeholder="eyJ..." />
          </div>

          <template v-if="pluginDraft.authMode === 'credentials'">
            <div class="grid gap-2">
              <label class="text-sm font-medium">Username</label>
              <Input v-model="pluginDraft.username" placeholder="username" />
            </div>
            <div class="grid gap-2">
              <label class="text-sm font-medium">Password</label>
              <Input v-model="pluginDraft.password" type="password" placeholder="password" />
            </div>
            <div class="grid gap-2">
              <label class="text-sm font-medium">Login URL</label>
              <Input v-model="pluginDraft.loginUrl" placeholder="https://.../login" />
            </div>
            <div class="grid gap-2">
              <label class="text-sm font-medium">Auth Check URL</label>
              <Input v-model="pluginDraft.authCheckUrl" placeholder="https://.../api/me" />
            </div>
            <div class="grid gap-2">
              <label class="text-sm font-medium">Timeout (sec)</label>
              <Input v-model="pluginDraft.timeoutSec" type="number" min="1" placeholder="120" />
            </div>
          </template>
        </div>

        <div class="flex items-center gap-2">
          <Button @click="initializeRuntime">Initialize Runtime</Button>
          <p v-if="initError" class="text-sm text-destructive">{{ initError }}</p>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Challenge Queue</CardTitle>
        <CardDescription>Current managed challenges and manual enqueue controls.</CardDescription>
      </CardHeader>
      <CardContent>
        <div class="grid gap-2">
          <article
            v-for="challenge in snapshot?.challenges ?? []"
            :key="challenge.challengeId"
            class="rounded-md border p-3"
          >
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h4 class="font-medium">#{{ challenge.challengeId }} {{ challenge.title }}</h4>
                <p class="text-xs text-muted-foreground">
                  {{ challenge.category }} · {{ challenge.score }} pts · solved
                  {{ challenge.solvedCount }}
                </p>
              </div>
              <Badge :variant="challenge.status === 'active' ? 'destructive' : 'outline'">
                {{ challenge.status }}
              </Badge>
            </div>

            <Separator class="my-3" />

            <div class="flex flex-wrap items-center gap-2">
              <Button variant="outline" @click="runtime.enqueueChallenge(challenge.challengeId)">
                Enqueue
              </Button>
              <Button variant="secondary" @click="openSolverAgent(challenge.solverId)">
                Open {{ challenge.solverId }}
              </Button>
            </div>
          </article>

          <p v-if="(snapshot?.challenges.length ?? 0) === 0" class="text-sm text-muted-foreground">
            No challenges loaded yet. Run challenge sync first.
          </p>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
