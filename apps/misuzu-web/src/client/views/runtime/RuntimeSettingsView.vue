<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue"
import type {
  ModelPoolInput,
  ProviderCatalogItem,
  ProviderConfigEntry,
  RuntimePlatformConfig,
} from "@shared/protocol.ts"
import ProviderConfigEditor from "@/components/workspace/ProviderConfigEditor.vue"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { useRuntimeWorkspace } from "@/composables/use-runtime-workspace.ts"
import { useAppServices } from "@/di/app-services.ts"

interface ModelPoolRow {
  id: string
  provider: string
  modelId: string
  maxConcurrency: string
}

const props = defineProps<{
  workspaceId: string
}>()

const runtime = useRuntimeWorkspace(props.workspaceId)
const { apiClient } = useAppServices()

const settingsLoading = ref(false)
const settingsError = ref("")

const providerCatalog = ref<ProviderCatalogItem[]>([])
const providerConfigDraft = ref<ProviderConfigEntry[]>([])
const providerConfigSaving = ref(false)
const providerConfigError = ref("")

const modelPoolDraft = ref<ModelPoolRow[]>([])
const modelPoolSaving = ref(false)
const modelPoolError = ref("")

const autoOrchestrateDraft = ref(false)
const runtimeConfigText = ref("")
const runtimeConfigSaving = ref(false)
const runtimeConfigError = ref("")

const snapshot = computed(() => runtime.snapshot.value)
const providerOptions = computed(() =>
  providerCatalog.value
    .map((item) => item.provider)
    .sort((left, right) => left.localeCompare(right)),
)

onMounted(async () => {
  await loadSettings()
  syncModelPoolDraftFromSnapshot()
})

watch(
  () => snapshot.value?.modelPool.items,
  () => {
    if (modelPoolSaving.value || modelPoolDraft.value.length > 0) {
      return
    }

    syncModelPoolDraftFromSnapshot()
  },
)

function createModelPoolRow(input?: Partial<ModelPoolInput>): ModelPoolRow {
  const fallbackProvider = providerCatalog.value[0]?.provider ?? "openai"
  const fallbackModelId = providerCatalog.value[0]?.models[0]?.modelId ?? "gpt-4.1"

  return {
    id: crypto.randomUUID(),
    provider: input?.provider ?? fallbackProvider,
    modelId: input?.modelId ?? fallbackModelId,
    maxConcurrency: String(input?.maxConcurrency ?? 1),
  }
}

function syncModelPoolDraftFromSnapshot() {
  const items = snapshot.value?.modelPool.items ?? []
  modelPoolDraft.value = items.length
    ? items.map((item) => createModelPoolRow(item))
    : [createModelPoolRow()]
}

function addModelPoolRow() {
  modelPoolDraft.value.push(createModelPoolRow())
}

function removeModelPoolRow(rowId: string) {
  if (modelPoolDraft.value.length <= 1) {
    return
  }

  modelPoolDraft.value = modelPoolDraft.value.filter((item) => item.id !== rowId)
}

function incrementConcurrency(rowId: string) {
  modelPoolDraft.value = modelPoolDraft.value.map((item) => {
    if (item.id !== rowId) {
      return item
    }

    const next = Number(item.maxConcurrency)
    return {
      ...item,
      maxConcurrency: String(Number.isFinite(next) ? next + 1 : 1),
    }
  })
}

function decrementConcurrency(rowId: string) {
  modelPoolDraft.value = modelPoolDraft.value.map((item) => {
    if (item.id !== rowId) {
      return item
    }

    const next = Number(item.maxConcurrency)
    return {
      ...item,
      maxConcurrency: String(Math.max(1, Number.isFinite(next) ? next - 1 : 1)),
    }
  })
}

function listModelsForProvider(provider: string) {
  return providerCatalog.value.find((item) => item.provider === provider)?.models ?? []
}

async function applyModelPool() {
  modelPoolError.value = ""
  modelPoolSaving.value = true

  try {
    if (!snapshot.value?.paused) {
      throw new Error("Pause flow before updating model pool")
    }

    const normalized = modelPoolDraft.value.map((item) => {
      const provider = item.provider.trim()
      const modelId = item.modelId.trim()
      const maxConcurrency = Number(item.maxConcurrency)
      if (!provider || !modelId) {
        throw new Error("Model pool provider/model id cannot be empty")
      }

      if (!Number.isInteger(maxConcurrency) || maxConcurrency <= 0) {
        throw new Error("Model pool maxConcurrency must be a positive integer")
      }

      return {
        provider,
        modelId,
        maxConcurrency,
      }
    })

    await runtime.updateModelPool(normalized)
    syncModelPoolDraftFromSnapshot()
  } catch (error) {
    modelPoolError.value = error instanceof Error ? error.message : String(error)
  } finally {
    modelPoolSaving.value = false
  }
}

async function loadSettings() {
  settingsLoading.value = true
  settingsError.value = ""

  try {
    const settings = await apiClient.getRuntimeSettings(props.workspaceId)
    providerCatalog.value = settings.providerCatalog
    providerConfigDraft.value = settings.providerConfig
    autoOrchestrateDraft.value = settings.autoOrchestrate
    runtimeConfigText.value = settings.platformConfig
      ? JSON.stringify(settings.platformConfig, null, 2)
      : ""
  } catch (error) {
    settingsError.value = error instanceof Error ? error.message : String(error)
  } finally {
    settingsLoading.value = false
  }
}

async function saveProviderConfig() {
  providerConfigError.value = ""
  providerConfigSaving.value = true
  try {
    await runtime.updateProviderConfig(providerConfigDraft.value)
    await loadSettings()
  } catch (error) {
    providerConfigError.value = error instanceof Error ? error.message : String(error)
  } finally {
    providerConfigSaving.value = false
  }
}

async function saveRuntimeConfig() {
  runtimeConfigError.value = ""
  runtimeConfigSaving.value = true
  try {
    let platformConfig: RuntimePlatformConfig | undefined
    if (runtimeConfigText.value.trim().length > 0) {
      const parsed = JSON.parse(runtimeConfigText.value) as RuntimePlatformConfig
      if (
        !parsed.pluginId?.trim() ||
        !parsed.pluginConfig ||
        typeof parsed.pluginConfig !== "object"
      ) {
        throw new Error("Runtime config must include pluginId and pluginConfig")
      }

      platformConfig = {
        pluginId: parsed.pluginId.trim(),
        pluginConfig: parsed.pluginConfig,
        cron: parsed.cron,
      }
    }

    await runtime.updateRuntimeConfig({
      autoOrchestrate: autoOrchestrateDraft.value,
      platformConfig,
    })

    await loadSettings()
  } catch (error) {
    runtimeConfigError.value = error instanceof Error ? error.message : String(error)
  } finally {
    runtimeConfigSaving.value = false
  }
}
</script>

<template>
  <div class="grid gap-4">
    <Card>
      <CardHeader>
        <CardTitle>Model Pool</CardTitle>
        <CardDescription>
          Incrementally tune provider/model concurrency. Pause dispatch before applying changes.
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-3">
        <article
          v-for="item in modelPoolDraft"
          :key="item.id"
          class="grid gap-3 rounded-md border p-3 md:grid-cols-[1fr_1fr_160px_auto]"
        >
          <Input
            v-model="item.provider"
            list="runtime-settings-provider-options"
            placeholder="provider"
          />
          <Input
            v-model="item.modelId"
            :list="`runtime-settings-model-options-${item.id}`"
            placeholder="model id"
          />
          <div class="flex items-center gap-1">
            <Button type="button" variant="outline" @click="decrementConcurrency(item.id)"
              >-</Button
            >
            <Input
              v-model="item.maxConcurrency"
              type="number"
              min="1"
              placeholder="max concurrency"
            />
            <Button type="button" variant="outline" @click="incrementConcurrency(item.id)"
              >+</Button
            >
          </div>
          <Button variant="ghost" type="button" @click="removeModelPoolRow(item.id)">Remove</Button>

          <datalist :id="`runtime-settings-model-options-${item.id}`">
            <option
              v-for="model in listModelsForProvider(item.provider)"
              :key="model.modelId"
              :value="model.modelId"
            />
          </datalist>
        </article>

        <div class="flex flex-wrap gap-2">
          <Button variant="outline" type="button" @click="addModelPoolRow">Add model</Button>
          <Button
            type="button"
            :disabled="!snapshot?.paused || modelPoolSaving"
            @click="applyModelPool"
          >
            {{ modelPoolSaving ? "Updating..." : "Apply Model Pool" }}
          </Button>
          <Button variant="ghost" type="button" @click="syncModelPoolDraftFromSnapshot"
            >Reset Draft</Button
          >
        </div>

        <p v-if="!snapshot?.paused" class="text-xs text-muted-foreground">
          Pause flow first to update model pool safely.
        </p>
        <p v-if="modelPoolError" class="text-sm text-destructive">{{ modelPoolError }}</p>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Runtime Config</CardTitle>
        <CardDescription>
          Configure auto orchestration and <code>platform.json</code>. New platform config is
          persisted for next runtime bootstrap.
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-3">
        <div class="flex items-center justify-between rounded-md border p-3">
          <div>
            <p class="text-sm font-medium">Enable auto orchestration</p>
            <p class="text-xs text-muted-foreground">Automatically rebalance challenge dispatch.</p>
          </div>
          <Switch
            :checked="autoOrchestrateDraft"
            @update:checked="(checked) => (autoOrchestrateDraft = Boolean(checked))"
          />
        </div>

        <div class="grid gap-2">
          <label class="text-sm font-medium">platform.json</label>
          <Textarea
            v-model="runtimeConfigText"
            class="min-h-44 font-mono text-xs"
            placeholder='{"pluginId":"ctfd","pluginConfig":{...}}'
          />
        </div>

        <div class="flex items-center gap-2">
          <Button :disabled="runtimeConfigSaving" @click="saveRuntimeConfig">
            {{ runtimeConfigSaving ? "Saving..." : "Save Runtime Config" }}
          </Button>
          <Button variant="outline" :disabled="settingsLoading" @click="loadSettings"
            >Reload</Button
          >
        </div>

        <p v-if="runtimeConfigError" class="text-sm text-destructive">{{ runtimeConfigError }}</p>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Provider Config</CardTitle>
        <CardDescription>
          Edit <code>providers.json</code> with form fields. Supports built-in providers and proxy
          providers with per-provider <code>api_key</code>.
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-3">
        <ProviderConfigEditor
          v-model="providerConfigDraft"
          :disabled="providerConfigSaving"
          :provider-options="providerOptions"
        />

        <div class="flex items-center gap-2">
          <Button :disabled="providerConfigSaving" @click="saveProviderConfig">
            {{ providerConfigSaving ? "Saving..." : "Save providers.json" }}
          </Button>
          <Button variant="outline" :disabled="settingsLoading" @click="loadSettings"
            >Reload</Button
          >
        </div>

        <p v-if="providerConfigError" class="text-sm text-destructive">{{ providerConfigError }}</p>
      </CardContent>
    </Card>

    <p v-if="settingsError" class="text-sm text-destructive">{{ settingsError }}</p>

    <datalist id="runtime-settings-provider-options">
      <option v-for="provider in providerOptions" :key="provider" :value="provider" />
    </datalist>
  </div>
</template>
