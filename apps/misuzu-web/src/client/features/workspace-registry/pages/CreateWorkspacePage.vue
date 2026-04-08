<script setup lang="ts">
import { CheckIcon, ChevronsUpDownIcon, HomeIcon, PlusIcon, UploadIcon } from "lucide-vue-next"
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
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import PlatformPluginForm from "@/features/workspace-runtime/components/PlatformPluginForm.vue"
import ProviderConfigEditor from "@/features/workspace-runtime/components/ProviderConfigEditor.vue"
import { useCreateWorkspacePage } from "@/features/workspace-registry/composables/use-create-workspace-page.ts"
import AppLayout from "@/layouts/AppLayout.vue"

const {
  steps,
  step,
  creating,
  formError,
  name,
  rootDir,
  providerConfigMode,
  providerConfigDraft,
  providerConfigSaved,
  providerConfigError,
  modelPool,
  runtimeAutoOrchestrate,
  selectedPluginId,
  pluginDraft,
  solverPromptTemplateDraft,
  skipPluginSetup,
  startFlowAfterCreate,
  providerOptions,
  normalizedModelPool,
  listModelsForProvider,
  addModelPoolRow,
  removeModelPoolRow,
  importProviderConfigFile,
  markProviderConfigDirty,
  saveProviderConfigDraft,
  nextStep,
  previousStep,
  skipPluginSetupForNow,
  createWorkspace,
  openHome,
} = useCreateWorkspacePage()

function handleProviderFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  void importProviderConfigFile(file)
  input.value = ""
}
</script>

<template>
  <AppLayout>
    <template #header-menu>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton @click="openHome">
            <HomeIcon />
            <span>Home</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton :is-active="true">
            <PlusIcon />
            <span>Create Workspace</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </template>

    <template #sidebar-content>
      <SidebarGroup>
        <SidebarGroupLabel>Wizard Progress</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem v-for="(item, index) in steps" :key="item">
              <SidebarMenuButton :is-active="index + 1 === step">
                <span class="truncate">Step {{ index + 1 }} · {{ item }}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </template>

    <header class="flex items-center justify-between gap-2 border-b px-4 py-3">
      <div class="flex items-center gap-2">
        <SidebarTrigger class="md:hidden" />
        <div>
          <p class="text-sm font-semibold">Create Runtime Workspace</p>
          <p class="text-xs text-muted-foreground">
            4-step guided setup for runtime orchestration.
          </p>
        </div>
      </div>
      <Button variant="outline" @click="openHome">Back Home</Button>
    </header>

    <section class="px-3 py-3 md:px-4">
      <div class="mx-auto w-full max-w-5xl space-y-6">
        <section class="grid gap-3 sm:grid-cols-4">
          <div
            v-for="(item, index) in steps"
            :key="item"
            class="rounded-lg border p-3"
            :class="index + 1 <= step ? 'border-foreground bg-secondary' : 'border-border bg-card'"
          >
            <p class="text-xs uppercase tracking-wide text-muted-foreground">
              Step {{ index + 1 }}
            </p>
            <p class="mt-1 text-sm font-medium">{{ item }}</p>
          </div>
        </section>

        <Card>
          <CardHeader>
            <CardTitle v-if="step === 1">Workspace Basics</CardTitle>
            <CardTitle v-else-if="step === 2">Providers & Model Pool</CardTitle>
            <CardTitle v-else-if="step === 3">Plugin Setup</CardTitle>
            <CardTitle v-else>Final Confirm</CardTitle>
            <CardDescription>
              <template v-if="step === 1">Set title and target workspace directory.</template>
              <template v-else-if="step === 2"
                >Configure providers.json first, then define model pool capacity.</template
              >
              <template v-else-if="step === 3"
                >Select plugin, configure auth/contest/base URL, then continue.</template
              >
              <template v-else>Review all settings and optionally start flow immediately.</template>
            </CardDescription>
          </CardHeader>

          <CardContent class="space-y-6">
            <template v-if="step === 1">
              <div class="grid gap-4 md:grid-cols-2">
                <div class="grid gap-2">
                  <label class="text-sm font-medium">Workspace title</label>
                  <Input v-model="name" placeholder="Runtime workspace title" />
                </div>
                <div class="grid gap-2">
                  <label class="text-sm font-medium">Workspace directory</label>
                  <Input v-model="rootDir" placeholder="Absolute workspace path" />
                </div>
              </div>
            </template>

            <template v-else-if="step === 2">
              <div class="space-y-3 rounded-md border p-3">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    providers.json
                  </h3>
                  <div class="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      :variant="providerConfigMode === 'form' ? 'default' : 'outline'"
                      @click="providerConfigMode = 'form'"
                    >
                      Form
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      :variant="providerConfigMode === 'upload' ? 'default' : 'outline'"
                      @click="providerConfigMode = 'upload'"
                    >
                      Upload
                    </Button>
                  </div>
                </div>

                <div v-if="providerConfigMode === 'upload'" class="grid gap-2">
                  <label class="text-sm font-medium">Upload providers.json</label>
                  <div class="flex flex-wrap items-center gap-2">
                    <Input
                      type="file"
                      accept="application/json,.json"
                      @change="handleProviderFileChange"
                    />
                    <Badge variant="secondary"> <UploadIcon class="mr-1 size-3" /> JSON </Badge>
                  </div>
                </div>

                <ProviderConfigEditor
                  :model-value="providerConfigDraft"
                  :provider-options="providerOptions"
                  @update:model-value="markProviderConfigDirty"
                />

                <div class="flex flex-wrap items-center gap-2">
                  <Button type="button" @click="saveProviderConfigDraft"
                    >Save providers.json</Button
                  >
                  <Badge v-if="providerConfigSaved" variant="secondary">
                    <CheckIcon class="mr-1 size-3" /> Saved
                  </Badge>
                </div>
                <p v-if="providerConfigError" class="text-sm text-destructive">
                  {{ providerConfigError }}
                </p>
              </div>

              <div
                class="space-y-3 rounded-md border p-3"
                :class="!providerConfigSaved ? 'opacity-70' : ''"
              >
                <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Model Pool
                </h3>

                <article
                  v-for="item in modelPool"
                  :key="item.id"
                  class="grid gap-3 rounded-md border p-3 md:grid-cols-[1fr_1fr_170px_auto]"
                >
                  <Combobox
                    :model-value="item.provider"
                    :disabled="!providerConfigSaved"
                    @update:model-value="(value) => (item.provider = String(value ?? ''))"
                  >
                    <ComboboxAnchor class="w-full">
                      <ComboboxTrigger as-child>
                        <Button
                          variant="outline"
                          class="w-full justify-between font-normal"
                          type="button"
                          :disabled="!providerConfigSaved"
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
                    :disabled="!providerConfigSaved || !item.provider"
                    @update:model-value="(value) => (item.modelId = String(value ?? ''))"
                  >
                    <ComboboxAnchor class="w-full">
                      <ComboboxTrigger as-child>
                        <Button
                          variant="outline"
                          class="w-full justify-between font-normal"
                          type="button"
                          :disabled="!providerConfigSaved || !item.provider"
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

                  <Input
                    v-model="item.maxConcurrency"
                    type="number"
                    min="1"
                    placeholder="max concurrency"
                    :disabled="!providerConfigSaved"
                  />
                  <Button
                    variant="ghost"
                    type="button"
                    :disabled="!providerConfigSaved"
                    @click="removeModelPoolRow(item.id)"
                  >
                    Remove
                  </Button>
                </article>

                <Button
                  variant="outline"
                  type="button"
                  :disabled="!providerConfigSaved"
                  @click="addModelPoolRow"
                >
                  Add model
                </Button>
              </div>
            </template>

            <template v-else-if="step === 3">
              <div class="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                <div class="space-y-4 rounded-md border p-3">
                  <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Plugin Selection
                  </h3>
                  <PlatformPluginForm
                    v-model:plugin-id="selectedPluginId"
                    :plugin-draft="pluginDraft"
                  />

                  <div class="grid gap-2">
                    <label class="text-sm font-medium">Solver Prompt Template</label>
                    <Textarea
                      v-model="solverPromptTemplateDraft"
                      placeholder="You are assigned to challenge {challenge.id} {challenge.title}..."
                      class="min-h-28 text-sm"
                    />
                  </div>

                  <div class="flex items-center justify-between rounded-md border p-3">
                    <div>
                      <p class="text-sm font-medium">Enable auto orchestration</p>
                      <p class="text-xs text-muted-foreground">
                        Automatically rebalance managed challenges after sync.
                      </p>
                    </div>
                    <Switch
                      :checked="runtimeAutoOrchestrate"
                      @update:checked="(checked) => (runtimeAutoOrchestrate = Boolean(checked))"
                    />
                  </div>
                </div>

                <div class="space-y-3 rounded-md border p-3">
                  <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    No Adapter Yet?
                  </h3>
                  <p class="text-sm text-muted-foreground">
                    You can create an Environment Agent now and adapt plugins in chat first, then
                    return to Settings later.
                  </p>
                  <Button variant="outline" type="button" @click="skipPluginSetupForNow">
                    Create a Environment Agent and skip for now
                  </Button>
                  <p class="text-xs text-muted-foreground">
                    This path locks the workspace to Agent chat and Settings until plugin setup is
                    completed.
                  </p>
                </div>
              </div>
            </template>

            <template v-else>
              <div class="grid gap-4 text-sm">
                <div class="flex items-center gap-2">
                  <Badge variant="secondary">ctf-runtime</Badge>
                  <span class="text-muted-foreground">{{ name }}</span>
                </div>

                <div class="grid gap-2 rounded-md border p-4">
                  <p><strong>Root:</strong> {{ rootDir }}</p>
                  <p><strong>providers.json entries:</strong> {{ providerConfigDraft.length }}</p>
                  <p><strong>Model pool size:</strong> {{ normalizedModelPool.length }}</p>
                  <p>
                    <strong>Plugin setup:</strong>
                    {{ skipPluginSetup ? "skip for now" : "configured" }}
                  </p>
                  <p>
                    <strong>Auto orchestration:</strong> {{ runtimeAutoOrchestrate ? "yes" : "no" }}
                  </p>
                </div>

                <div class="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <p class="text-sm font-medium">Start flow automatically after creation</p>
                    <p class="text-xs text-muted-foreground">
                      Available when plugin setup is completed in this wizard.
                    </p>
                  </div>
                  <Switch
                    :checked="startFlowAfterCreate"
                    :disabled="skipPluginSetup"
                    @update:checked="(checked) => (startFlowAfterCreate = Boolean(checked))"
                  />
                </div>
              </div>
            </template>

            <p v-if="formError" class="text-sm text-destructive">{{ formError }}</p>

            <div class="flex flex-wrap justify-between gap-2">
              <Button variant="outline" :disabled="step === 1 || creating" @click="previousStep">
                Back
              </Button>

              <div class="flex gap-2">
                <Button v-if="step < steps.length" :disabled="creating" @click="nextStep">
                  Continue
                </Button>
                <Button v-else :disabled="creating" @click="createWorkspace">
                  {{ creating ? "Creating..." : "Create Workspace" }}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  </AppLayout>
</template>
