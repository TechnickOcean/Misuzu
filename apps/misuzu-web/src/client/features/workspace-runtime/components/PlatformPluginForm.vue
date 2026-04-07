<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue"
import { CheckIcon, ChevronsUpDownIcon } from "lucide-vue-next"
import { Button } from "@/components/ui/button"
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { marked } from "marked"
import type { PluginCatalogItem } from "@shared/protocol.ts"
import type { PluginConfigDraft } from "@/features/workspace-runtime/composables/plugin-config-form.ts"
import { useAppServices } from "@/shared/di/app-services.ts"

const props = defineProps<{
  pluginId: string
  pluginDraft: PluginConfigDraft
}>()

const emit = defineEmits<{
  "update:pluginId": [value: string]
}>()

const { apiClient } = useAppServices()

const plugins = ref<PluginCatalogItem[]>([])
const pluginReadmeHtml = ref("")
const pluginComboboxOpen = ref(false)

const selectedPlugin = computed(() => plugins.value.find((plugin) => plugin.id === props.pluginId))

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

watch(
  () => props.pluginId,
  async (newPluginId) => {
    if (!newPluginId) {
      pluginReadmeHtml.value = ""
      return
    }
    await loadPluginReadme(newPluginId)
    pluginComboboxOpen.value = false
  },
)

async function loadPlugins() {
  plugins.value = await apiClient.listPlugins()
  if (!props.pluginId && plugins.value.length > 0) {
    emit("update:pluginId", plugins.value[0].id)
    return
  }
  if (!plugins.value.some((plugin) => plugin.id === props.pluginId)) {
    emit("update:pluginId", plugins.value[0]?.id ?? "")
  }
}

async function loadPluginReadme(id: string) {
  const readme = await apiClient.getPluginReadme(id)
  pluginReadmeHtml.value = await marked.parse(readme.markdown)
}

function setContestMode(value: string) {
  props.pluginDraft.contestMode = value as "auto" | "id" | "title" | "url"
}

function setAuthMode(value: string) {
  props.pluginDraft.authMode = value as "manual" | "credentials"
}
</script>

<template>
  <div class="grid gap-4">
    <Combobox
      :model-value="pluginId"
      @update:model-value="(v) => emit('update:pluginId', v as string)"
      :open="pluginComboboxOpen"
      @update:open="(value) => (pluginComboboxOpen = Boolean(value))"
    >
      <ComboboxAnchor class="w-full">
        <Button variant="outline" class="w-full justify-between font-normal" type="button">
          <span class="truncate">{{ selectedPluginLabel }}</span>
          <ChevronsUpDownIcon class="size-4 shrink-0 opacity-50" />
        </Button>
      </ComboboxAnchor>

      <ComboboxList class="w-(--reka-popper-anchor-width) p-0">
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

    <div class="flex flex-wrap gap-2">
      <Button variant="outline" type="button" class="w-fit" @click="loadPlugins"
        >Refresh Plugins</Button
      >
      <Button
        v-if="pluginId"
        variant="secondary"
        type="button"
        class="w-fit"
        @click="loadPluginReadme(pluginId)"
      >
        Refresh README
      </Button>
    </div>

    <article v-if="pluginReadmeHtml" class="rounded-md border bg-muted/30 p-3">
      <h4 v-if="selectedPlugin" class="mb-2 text-sm font-medium">
        {{ selectedPlugin.name }} README
      </h4>
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
            <SelectItem value="credentials">credentials</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <p class="text-xs text-muted-foreground md:col-span-2">
        Recommended: start with <code>manual</code> so EnvironmentAgent can assist adapter debugging
        and plugin maintenance.
      </p>

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
  </div>
</template>
