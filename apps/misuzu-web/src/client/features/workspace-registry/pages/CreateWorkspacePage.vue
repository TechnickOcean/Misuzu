<script setup lang="ts">
import { CheckIcon, ChevronsUpDownIcon, HomeIcon, PlusIcon } from "lucide-vue-next"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import PlatformPluginForm from "@/features/workspace-runtime/components/PlatformPluginForm.vue"
import { useCreateWorkspacePage } from "@/features/workspace-registry/composables/use-create-workspace-page.ts"
import ProviderConfigEditor from "@/features/workspace-runtime/components/ProviderConfigEditor.vue"
import AppLayout from "@/layouts/AppLayout.vue"

const {
  steps,
  step,
  creating,
  formError,
  kind,
  name,
  rootDir,
  runtimeWithPlugin,
  runtimeAutoOrchestrate,
  modelPool,
  providerConfigEnabled,
  providerConfigDraft,
  selectedPluginId,
  pluginDraft,
  solverProvider,
  solverModelId,
  solverSystemPrompt,
  providerOptions,
  normalizedModelPool,
  listModelsForProvider,
  addModelPoolRow,
  removeModelPoolRow,
  nextStep,
  previousStep,
  createWorkspace,
  openHome,
} = useCreateWorkspacePage()
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
          <p class="text-sm font-semibold">Create Workspace</p>
          <p class="text-xs text-muted-foreground">Guided setup for runtime or solver workspace.</p>
        </div>
      </div>
      <Button variant="outline" @click="openHome">Back Home</Button>
    </header>

    <section class="px-3 py-3 md:px-4">
      <div class="mx-auto w-full max-w-5xl space-y-6">
        <section class="grid gap-3 sm:grid-cols-3">
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
            <CardTitle v-else-if="step === 2">Configuration</CardTitle>
            <CardTitle v-else>Review</CardTitle>
            <CardDescription>
              <template v-if="step === 1">Choose workspace type and basic metadata.</template>
              <template v-else-if="step === 2"
                >Configure runtime/solver options with guided forms.</template
              >
              <template v-else>Confirm setup and create workspace.</template>
            </CardDescription>
          </CardHeader>

          <CardContent class="space-y-6">
            <template v-if="step === 1">
              <div class="grid gap-2">
                <label class="text-sm font-medium">Workspace type</label>
                <Select v-model="kind">
                  <SelectTrigger class="w-full">
                    <SelectValue placeholder="Select workspace type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ctf-runtime">CTF Runtime Workspace</SelectItem>
                    <SelectItem value="solver">Solver Workspace</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div class="grid gap-4 md:grid-cols-2">
                <div class="grid gap-2">
                  <label class="text-sm font-medium">Workspace name</label>
                  <Input v-model="name" placeholder="optional display name" />
                </div>
                <div class="grid gap-2">
                  <label class="text-sm font-medium">Root directory</label>
                  <Input v-model="rootDir" placeholder="optional absolute path" />
                </div>
              </div>
            </template>

            <template v-else-if="step === 2">
              <template v-if="kind === 'ctf-runtime'">
                <div class="space-y-3">
                  <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Model Pool
                  </h3>

                  <article
                    v-for="item in modelPool"
                    :key="item.id"
                    class="grid gap-3 rounded-md border p-3 md:grid-cols-[1fr_1fr_150px_auto]"
                  >
                    <Input
                      v-model="item.provider"
                      list="create-workspace-provider-options"
                      placeholder="provider"
                    />
                    <Input
                      v-model="item.modelId"
                      :list="`create-workspace-model-options-${item.id}`"
                      placeholder="model id"
                    />
                    <Input
                      v-model="item.maxConcurrency"
                      type="number"
                      min="1"
                      placeholder="max concurrency"
                    />
                    <Button variant="ghost" type="button" @click="removeModelPoolRow(item.id)"
                      >Remove</Button
                    >
                  </article>

                  <Button variant="outline" type="button" @click="addModelPoolRow"
                    >Add model</Button
                  >

                  <template v-for="item in modelPool" :key="`model-option-${item.id}`">
                    <datalist :id="`create-workspace-model-options-${item.id}`">
                      <option
                        v-for="model in listModelsForProvider(item.provider)"
                        :key="model.modelId"
                        :value="model.modelId"
                      />
                    </datalist>
                  </template>
                </div>

                <Separator />

                <div class="grid gap-3 md:grid-cols-2">
                  <div class="flex items-center justify-between rounded-md border p-3">
                    <div>
                      <p class="text-sm font-medium">Initialize plugin now</p>
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
                      <p class="text-sm font-medium">Enable auto orchestration</p>
                      <p class="text-xs text-muted-foreground">
                        Auto enqueue managed challenges after sync.
                      </p>
                    </div>
                    <Switch
                      :checked="runtimeAutoOrchestrate"
                      @update:checked="(checked) => (runtimeAutoOrchestrate = Boolean(checked))"
                    />
                  </div>
                </div>

                <template v-if="runtimeWithPlugin">
                  <Separator />

                  <div class="grid gap-3">
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Platform Plugin
                    </h3>

                    <PlatformPluginForm
                      v-model:plugin-id="selectedPluginId"
                      :plugin-draft="pluginDraft"
                    />
                  </div>

                  <div class="grid gap-2 mt-4">
                    <label class="text-sm font-medium">Solver Prompt Template</label>
                    <p class="text-xs text-muted-foreground">
                      Optional template for dispatching tasks to solver agents. Use variables like
                      <code>{challenge.title}</code>, <code>{challenge.score}</code>,
                      <code>{payload}</code>.
                    </p>
                    <Textarea
                      v-model="solverPromptTemplateDraft"
                      placeholder="You are assigned to challenge {challenge.id} {challenge.title}..."
                      class="min-h-32 text-sm"
                    />
                  </div>
                </template>
              </template>

              <template v-else>
                <div class="grid gap-4 md:grid-cols-2">
                  <div class="grid gap-2">
                    <label class="text-sm font-medium">Provider</label>
                    <Input
                      v-model="solverProvider"
                      list="create-workspace-provider-options"
                      placeholder="openai"
                    />
                  </div>

                  <div class="grid gap-2">
                    <label class="text-sm font-medium">Model ID</label>
                    <Input
                      v-model="solverModelId"
                      list="create-workspace-solver-model-options"
                      placeholder="gpt-4.1"
                    />
                  </div>

                  <div class="grid gap-2 md:col-span-2">
                    <label class="text-sm font-medium">System Prompt (optional)</label>
                    <Textarea
                      v-model="solverSystemPrompt"
                      class="min-h-32"
                      placeholder="Optional instructions for standalone solver agent"
                    />
                  </div>
                </div>
              </template>

              <Separator />

              <div class="space-y-3">
                <div class="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <p class="text-sm font-medium">Edit providers.json before create</p>
                    <p class="text-xs text-muted-foreground">
                      Optional: configure built-in/provider proxy API keys and model mappings.
                    </p>
                  </div>
                  <Switch
                    :checked="providerConfigEnabled"
                    @update:checked="(checked) => (providerConfigEnabled = Boolean(checked))"
                  />
                </div>

                <ProviderConfigEditor
                  v-if="providerConfigEnabled"
                  v-model="providerConfigDraft"
                  :provider-options="providerOptions"
                />
              </div>
            </template>

            <template v-else>
              <div class="grid gap-4 text-sm">
                <div class="flex items-center gap-2">
                  <Badge variant="secondary">{{ kind }}</Badge>
                  <span class="text-muted-foreground">{{ name || "Unnamed workspace" }}</span>
                </div>

                <div class="grid gap-2 rounded-md border p-4">
                  <p><strong>Root:</strong> {{ rootDir || "auto-generated" }}</p>
                  <p>
                    <strong>providers.json:</strong>
                    {{
                      providerConfigEnabled ? `${providerConfigDraft.length} entries` : "default"
                    }}
                  </p>

                  <template v-if="kind === 'ctf-runtime'">
                    <p><strong>Models:</strong> {{ normalizedModelPool.length }}</p>
                    <p><strong>With plugin:</strong> {{ runtimeWithPlugin ? "yes" : "no" }}</p>
                    <p>
                      <strong>Auto orchestration:</strong>
                      {{ runtimeAutoOrchestrate ? "yes" : "no" }}
                    </p>
                    <p v-if="runtimeWithPlugin">
                      <strong>Plugin:</strong> {{ selectedPluginId || "not selected" }}
                    </p>
                  </template>

                  <template v-else>
                    <p><strong>Provider:</strong> {{ solverProvider }}</p>
                    <p><strong>Model:</strong> {{ solverModelId }}</p>
                  </template>
                </div>
              </div>
            </template>

            <datalist id="create-workspace-provider-options">
              <option v-for="provider in providerOptions" :key="provider" :value="provider" />
            </datalist>

            <datalist id="create-workspace-solver-model-options">
              <option
                v-for="model in listModelsForProvider(solverProvider)"
                :key="model.modelId"
                :value="model.modelId"
              />
            </datalist>

            <p v-if="formError" class="text-sm text-destructive">{{ formError }}</p>

            <div class="flex flex-wrap justify-between gap-2">
              <Button variant="outline" :disabled="step === 1 || creating" @click="previousStep"
                >Back</Button
              >

              <div class="flex gap-2">
                <Button v-if="step < steps.length" :disabled="creating" @click="nextStep"
                  >Continue</Button
                >
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
