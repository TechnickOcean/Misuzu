<script setup lang="ts">
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import PlatformPluginForm from "@/features/workspace-runtime/components/PlatformPluginForm.vue"
import ProviderConfigEditor from "@/features/workspace-runtime/components/ProviderConfigEditor.vue"
import { useRuntimeSettingsPage } from "@/features/workspace-runtime/composables/use-runtime-settings-page.ts"

const props = defineProps<{
  workspaceId: string
}>()

const {
  snapshot,
  settingsLoading,
  settingsError,
  providerConfigDraft,
  providerConfigSaving,
  providerConfigError,
  modelPoolDraft,
  modelPoolSaving,
  modelPoolError,
  autoOrchestrateDraft,
  pluginIdDraft,
  pluginConfigDraft,
  runtimeConfigSaving,
  runtimeConfigError,
  providerOptions,
  addModelPoolRow,
  removeModelPoolRow,
  incrementConcurrency,
  decrementConcurrency,
  listModelsForProvider,
  applyModelPool,
  syncModelPoolDraftFromSnapshot,
  loadSettings,
  saveProviderConfig,
  saveRuntimeConfig,
} = useRuntimeSettingsPage(props.workspaceId)
</script>

<template>
  <div v-if="settingsLoading && !providerOptions.length" class="grid gap-4">
    <Skeleton class="h-[200px] w-full rounded-xl" />
    <Skeleton class="h-[200px] w-full rounded-xl" />
    <Skeleton class="h-[200px] w-full rounded-xl" />
  </div>

  <div v-else class="grid gap-4">
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
          <label class="text-sm font-medium">Platform Plugin</label>
          <PlatformPluginForm v-model:plugin-id="pluginIdDraft" :plugin-draft="pluginConfigDraft" />
        </div>

        <div class="grid gap-2">
          <label class="text-sm font-medium">Solver Prompt Template</label>
          <p class="text-xs text-muted-foreground">
            Optional template for dispatching tasks to solver agents. Use variables like
            <code>{challenge.title}</code>, <code>{challenge.score}</code>, <code>{payload}</code>.
          </p>
          <Textarea
            v-model="solverPromptTemplateDraft"
            placeholder="You are assigned to challenge {challenge.id} {challenge.title}..."
            class="min-h-32 text-sm"
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
