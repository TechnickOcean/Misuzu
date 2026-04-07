<script setup lang="ts">
import { computed } from "vue"
import type { ProviderConfigEntry } from "@shared/protocol.ts"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const props = withDefaults(
  defineProps<{
    modelValue: ProviderConfigEntry[]
    disabled?: boolean
    providerOptions?: string[]
  }>(),
  {
    disabled: false,
    providerOptions: () => [],
  },
)

const emit = defineEmits<{
  (event: "update:modelValue", payload: ProviderConfigEntry[]): void
}>()

const rows = computed(() => props.modelValue)

function addEntry() {
  emit("update:modelValue", [
    ...rows.value,
    {
      provider: "",
      baseProvider: "",
      baseUrl: "",
      apiKeyEnvVar: "",
      api_key: "",
      modelMappings: [],
    },
  ])
}

function removeEntry(index: number) {
  emit(
    "update:modelValue",
    rows.value.filter((_, rowIndex) => rowIndex !== index),
  )
}

function patchEntry(index: number, patch: Partial<ProviderConfigEntry>) {
  const next = rows.value.map((entry, rowIndex) => {
    if (rowIndex !== index) {
      return entry
    }

    return {
      ...entry,
      ...patch,
    }
  })

  emit("update:modelValue", next)
}

function setEntryMode(index: number, mode: string) {
  if (mode === "proxy") {
    patchEntry(index, { baseProvider: rows.value[index]?.baseProvider?.trim() || "openai" })
    return
  }

  patchEntry(index, {
    baseProvider: undefined,
    baseUrl: undefined,
    modelIds: undefined,
    modelMappings: undefined,
  })
}

function getEntryMode(entry: ProviderConfigEntry) {
  return entry.baseProvider ? "proxy" : "builtin"
}

function getMappingsText(entry: ProviderConfigEntry) {
  if (!entry.modelMappings?.length) {
    return ""
  }

  return entry.modelMappings
    .map((mapping) => {
      if (typeof mapping === "string") {
        return mapping
      }

      if (!mapping.targetModelId || mapping.targetModelId === mapping.sourceModelId) {
        return mapping.sourceModelId
      }

      return `${mapping.sourceModelId}:${mapping.targetModelId}`
    })
    .join(",")
}

function setMappingsText(index: number, value: string | number) {
  const raw = String(value)
  const mappings = raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => {
      const [sourceModelId, targetModelId] = item.split(":").map((valuePart) => valuePart.trim())
      if (!targetModelId || targetModelId === sourceModelId) {
        return sourceModelId
      }

      return {
        sourceModelId,
        targetModelId,
      }
    })

  patchEntry(index, {
    modelMappings: mappings.length > 0 ? mappings : undefined,
  })
}
</script>

<template>
  <div class="space-y-3">
    <article
      v-for="(entry, index) in rows"
      :key="`${entry.provider}-${String(index)}`"
      class="space-y-3 rounded-md border p-3"
    >
      <div class="grid gap-3 md:grid-cols-3">
        <div class="grid gap-2">
          <label class="text-sm font-medium">Provider</label>
          <Input
            :model-value="entry.provider"
            :disabled="disabled"
            list="provider-config-provider-options"
            placeholder="openai"
            @update:model-value="(value) => patchEntry(index, { provider: String(value) })"
          />
        </div>

        <div class="grid gap-2">
          <label class="text-sm font-medium">Type</label>
          <Select
            :model-value="getEntryMode(entry)"
            @update:model-value="(value) => setEntryMode(index, value)"
          >
            <SelectTrigger>
              <SelectValue placeholder="Select provider type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="builtin">Built-in Provider</SelectItem>
              <SelectItem value="proxy">Proxy Provider</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div class="grid gap-2">
          <label class="text-sm font-medium">API Key (api_key)</label>
          <Input
            :model-value="entry.api_key"
            :disabled="disabled"
            type="password"
            placeholder="optional inline key"
            @update:model-value="(value) => patchEntry(index, { api_key: String(value) })"
          />
        </div>

        <div class="grid gap-2">
          <label class="text-sm font-medium">API Key Env Var</label>
          <Input
            :model-value="entry.apiKeyEnvVar"
            :disabled="disabled"
            placeholder="OPENAI_API_KEY"
            @update:model-value="(value) => patchEntry(index, { apiKeyEnvVar: String(value) })"
          />
        </div>

        <template v-if="getEntryMode(entry) === 'proxy'">
          <div class="grid gap-2">
            <label class="text-sm font-medium">Base Provider</label>
            <Input
              :model-value="entry.baseProvider"
              :disabled="disabled"
              list="provider-config-provider-options"
              placeholder="openai"
              @update:model-value="(value) => patchEntry(index, { baseProvider: String(value) })"
            />
          </div>

          <div class="grid gap-2 md:col-span-2">
            <label class="text-sm font-medium">Base URL</label>
            <Input
              :model-value="entry.baseUrl"
              :disabled="disabled"
              placeholder="https://proxy.example.com/v1"
              @update:model-value="(value) => patchEntry(index, { baseUrl: String(value) })"
            />
          </div>

          <div class="grid gap-2 md:col-span-3">
            <label class="text-sm font-medium">Model Mappings</label>
            <Input
              :model-value="getMappingsText(entry)"
              :disabled="disabled"
              placeholder="gpt-4.1,gpt-4o:gpt-4o-mini"
              @update:model-value="(value) => setMappingsText(index, value)"
            />
            <p class="text-xs text-muted-foreground">
              Use comma separated values. You can map with <code>source:target</code>.
            </p>
          </div>
        </template>
      </div>

      <div class="flex justify-end">
        <Button variant="ghost" type="button" :disabled="disabled" @click="removeEntry(index)">
          Remove
        </Button>
      </div>
    </article>

    <Button variant="outline" type="button" :disabled="disabled" @click="addEntry">
      Add Provider Entry
    </Button>

    <datalist id="provider-config-provider-options">
      <option v-for="provider in providerOptions" :key="provider" :value="provider" />
    </datalist>
  </div>
</template>
