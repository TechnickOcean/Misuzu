<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue"
import { marked } from "marked"
import { useRouter } from "vue-router"
import type { PluginCatalogItem } from "@shared/protocol.ts"
import { CheckIcon, ChevronsUpDownIcon } from "lucide-vue-next"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Combobox,
  ComboboxAnchor,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxList,
  ComboboxViewport,
} from "@/components/ui/combobox"
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
const selectedPluginId = ref("")
const pluginReadmeHtml = ref("")
const pluginComboboxOpen = ref(false)
const pluginDraft = reactive<PluginConfigDraft>(createDefaultPluginConfigDraft())
const initError = ref("")

const snapshot = computed(() => runtime.snapshot.value)
const activeChallenges = computed(() =>
  (snapshot.value?.challenges ?? []).filter((challenge) => challenge.status === "active"),
)
const queuedChallenges = computed(() =>
  (snapshot.value?.challenges ?? []).filter((challenge) => challenge.status === "queued"),
)
const historyChallenges = computed(() =>
  (snapshot.value?.challenges ?? []).filter(
    (challenge) =>
      challenge.status === "solved" ||
      challenge.status === "blocked" ||
      challenge.status === "idle",
  ),
)
const selectedPlugin = computed(() =>
  plugins.value.find((plugin) => plugin.id === selectedPluginId.value),
)
const selectedPluginLabel = computed(() => {
  const plugin = selectedPlugin.value
  if (!plugin) {
    return "Select plugin"
  }

  return `${plugin.name} (${plugin.id})`
})

onMounted(async () => {
  await loadPlugins()
})

watch(selectedPluginId, async (pluginId) => {
  if (!pluginId) {
    pluginReadmeHtml.value = ""
    return
  }

  await loadPluginReadme(pluginId)
  pluginComboboxOpen.value = false
})

async function loadPlugins() {
  plugins.value = await apiClient.listPlugins()
  if (!selectedPluginId.value && plugins.value.length > 0) {
    selectedPluginId.value = plugins.value[0].id
    return
  }

  if (!plugins.value.some((plugin) => plugin.id === selectedPluginId.value)) {
    selectedPluginId.value = plugins.value[0]?.id ?? ""
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

function badgeVariantForStatus(status: "active" | "queued" | "solved" | "blocked" | "idle") {
  switch (status) {
    case "active":
      return "destructive"
    case "queued":
      return "secondary"
    case "solved":
      return "default"
    case "blocked":
      return "outline"
    case "idle":
      return "outline"
  }
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
        <Combobox
          v-model="selectedPluginId"
          :open="pluginComboboxOpen"
          @update:open="(value) => (pluginComboboxOpen = Boolean(value))"
        >
          <ComboboxAnchor class="w-full">
            <Button variant="outline" class="w-full justify-between font-normal" type="button">
              <span class="truncate">{{ selectedPluginLabel }}</span>
              <ChevronsUpDownIcon class="size-4 shrink-0 opacity-50" />
            </Button>
          </ComboboxAnchor>

          <ComboboxList class="w-[var(--reka-popper-anchor-width)] p-0">
            <ComboboxInput placeholder="Search plugin by name or id..." />
            <ComboboxEmpty>No plugin found.</ComboboxEmpty>

            <ComboboxViewport>
              <ComboboxGroup>
                <ComboboxItem
                  v-for="plugin in plugins"
                  :key="plugin.id"
                  :value="plugin.id"
                  class="justify-between"
                >
                  <span class="truncate">{{ plugin.name }} ({{ plugin.id }})</span>
                  <ComboboxItemIndicator>
                    <CheckIcon class="size-4" />
                  </ComboboxItemIndicator>
                </ComboboxItem>
              </ComboboxGroup>
            </ComboboxViewport>
          </ComboboxList>
        </Combobox>

        <Button variant="outline" class="w-fit" @click="loadPlugins">Refresh Plugins</Button>

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
        <CardDescription>
          Ordered as active first, queued (collapsed), then solved/blocked history.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div class="space-y-4">
          <section v-if="activeChallenges.length" class="space-y-2">
            <p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Active
            </p>
            <article
              v-for="challenge in activeChallenges"
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
                <Badge :variant="badgeVariantForStatus(challenge.status)">
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
          </section>

          <details v-if="queuedChallenges.length" class="rounded-md border p-3">
            <summary class="cursor-pointer text-xs font-semibold uppercase tracking-wide">
              Queued ({{ queuedChallenges.length }})
            </summary>
            <div class="mt-3 grid gap-2">
              <article
                v-for="challenge in queuedChallenges"
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
                  <Badge :variant="badgeVariantForStatus(challenge.status)">
                    {{ challenge.status }}
                  </Badge>
                </div>

                <Separator class="my-3" />

                <div class="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    @click="runtime.enqueueChallenge(challenge.challengeId)"
                  >
                    Enqueue
                  </Button>
                  <Button variant="secondary" @click="openSolverAgent(challenge.solverId)">
                    Open {{ challenge.solverId }}
                  </Button>
                </div>
              </article>
            </div>
          </details>

          <section v-if="historyChallenges.length" class="space-y-2">
            <p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Solved / Blocked
            </p>
            <article
              v-for="challenge in historyChallenges"
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
                  <p v-if="challenge.statusReason" class="text-xs text-muted-foreground">
                    {{ challenge.statusReason }}
                  </p>
                </div>
                <Badge :variant="badgeVariantForStatus(challenge.status)">
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
          </section>

          <p v-if="(snapshot?.challenges.length ?? 0) === 0" class="text-sm text-muted-foreground">
            No challenges loaded yet. Run challenge sync first.
          </p>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
