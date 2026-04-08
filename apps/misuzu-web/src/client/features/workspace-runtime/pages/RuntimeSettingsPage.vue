<script setup lang="ts">
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
  ComboboxTrigger,
  ComboboxViewport,
} from "@/components/ui/combobox"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
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
  providerConfigNotice,
  modelPoolDraft,
  modelPoolSaving,
  modelPoolError,
  modelPoolNotice,
  autoOrchestrateDraft,
  pluginIdDraft,
  pluginConfigDraft,
  solverPromptTemplateDraft,
  runtimeConfigSaving,
  runtimeConfigError,
  runtimeConfigNotice,
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
    <Skeleton class="h-[220px] w-full rounded-xl" />
    <Skeleton class="h-[220px] w-full rounded-xl" />
  </div>

  <div v-else class="grid gap-4">
    <Card>
      <CardHeader>
        <CardTitle>Runtime Settings</CardTitle>
        <CardDescription>
          Settings mirror create-workspace flow. Some updates require runtime restart to fully take
          effect.
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">Current phase: {{ snapshot?.setupPhase ?? "loading" }}</Badge>
          <span>Restart recommended after provider/plugin changes.</span>
        </div>

        <Tabs default-value="runtime" class="space-y-4">
          <TabsList class="grid w-full grid-cols-3">
            <TabsTrigger value="runtime">Prompt & Plugin</TabsTrigger>
            <TabsTrigger value="providers">Providers</TabsTrigger>
            <TabsTrigger value="model-pool">Model Pool</TabsTrigger>
          </TabsList>

          <TabsContent value="runtime" class="space-y-3">
            <div class="flex items-center justify-between rounded-md border p-3">
              <div>
                <p class="text-sm font-medium">Enable auto orchestration</p>
                <p class="text-xs text-muted-foreground">
                  Automatically rebalance challenge dispatch.
                </p>
              </div>
              <Switch
                :checked="autoOrchestrateDraft"
                @update:checked="(checked) => (autoOrchestrateDraft = Boolean(checked))"
              />
            </div>

            <div class="grid gap-2">
              <label class="text-sm font-medium">Platform Plugin</label>
              <PlatformPluginForm
                v-model:plugin-id="pluginIdDraft"
                :plugin-draft="pluginConfigDraft"
              />
            </div>

            <div class="grid gap-2">
              <label class="text-sm font-medium">Solver Prompt Template</label>
              <p class="text-xs text-muted-foreground">
                Changes to prompt templates affect new dispatch rounds after runtime restart.
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

            <p v-if="runtimeConfigError" class="text-sm text-destructive">
              {{ runtimeConfigError }}
            </p>
            <p v-if="runtimeConfigNotice" class="text-sm text-muted-foreground">
              {{ runtimeConfigNotice }}
            </p>
          </TabsContent>

          <TabsContent value="providers" class="space-y-3">
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

            <p class="text-xs text-muted-foreground">
              Provider changes generally require runtime restart before all agents pick up new model
              mappings.
            </p>
            <p v-if="providerConfigError" class="text-sm text-destructive">
              {{ providerConfigError }}
            </p>
            <p v-if="providerConfigNotice" class="text-sm text-muted-foreground">
              {{ providerConfigNotice }}
            </p>
          </TabsContent>

          <TabsContent value="model-pool" class="space-y-3">
            <article
              v-for="item in modelPoolDraft"
              :key="item.id"
              class="grid gap-3 rounded-md border p-3 md:grid-cols-[1fr_1fr_160px_auto]"
            >
              <Combobox
                :model-value="item.provider"
                @update:model-value="(value) => (item.provider = String(value ?? ''))"
              >
                <ComboboxAnchor class="w-full">
                  <ComboboxTrigger as-child>
                    <Button
                      variant="outline"
                      class="w-full justify-between font-normal"
                      type="button"
                    >
                      <span class="truncate">{{ item.provider || "Select provider" }}</span>
                      <ChevronsUpDownIcon class="size-4 shrink-0 opacity-50" />
                    </Button>
                  </ComboboxTrigger>
                </ComboboxAnchor>

                <ComboboxList class="w-(--reka-popper-anchor-width) p-0">
                  <ComboboxInput placeholder="Search provider..." />
                  <ComboboxEmpty>No provider found.</ComboboxEmpty>
                  <ComboboxViewport>
                    <ComboboxGroup>
                      <ComboboxItem
                        v-for="provider in providerOptions"
                        :key="provider"
                        :value="provider"
                        class="justify-between"
                      >
                        <span class="truncate">{{ provider }}</span>
                        <ComboboxItemIndicator>
                          <CheckIcon class="size-4" />
                        </ComboboxItemIndicator>
                      </ComboboxItem>
                    </ComboboxGroup>
                  </ComboboxViewport>
                </ComboboxList>
              </Combobox>

              <Combobox
                :model-value="item.modelId"
                :disabled="!item.provider"
                @update:model-value="(value) => (item.modelId = String(value ?? ''))"
              >
                <ComboboxAnchor class="w-full">
                  <ComboboxTrigger as-child>
                    <Button
                      variant="outline"
                      class="w-full justify-between font-normal"
                      type="button"
                      :disabled="!item.provider"
                    >
                      <span class="truncate">{{ item.modelId || "Select model" }}</span>
                      <ChevronsUpDownIcon class="size-4 shrink-0 opacity-50" />
                    </Button>
                  </ComboboxTrigger>
                </ComboboxAnchor>

                <ComboboxList class="w-(--reka-popper-anchor-width) p-0">
                  <ComboboxInput placeholder="Search model..." />
                  <ComboboxEmpty>No model found.</ComboboxEmpty>
                  <ComboboxViewport>
                    <ComboboxGroup>
                      <ComboboxItem
                        v-for="model in listModelsForProvider(item.provider)"
                        :key="model.modelId"
                        :value="model.modelId"
                        class="justify-between"
                      >
                        <span class="truncate">{{ model.modelId }}</span>
                        <ComboboxItemIndicator>
                          <CheckIcon class="size-4" />
                        </ComboboxItemIndicator>
                      </ComboboxItem>
                    </ComboboxGroup>
                  </ComboboxViewport>
                </ComboboxList>
              </Combobox>

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
              <Button variant="ghost" type="button" @click="removeModelPoolRow(item.id)"
                >Remove</Button
              >
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
            <p v-if="modelPoolNotice" class="text-sm text-muted-foreground">
              {{ modelPoolNotice }}
            </p>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>

    <p v-if="settingsError" class="text-sm text-destructive">{{ settingsError }}</p>
  </div>
</template>
