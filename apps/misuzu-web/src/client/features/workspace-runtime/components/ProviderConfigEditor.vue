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
      api_key: "$env:OPENAI_API_KEY",
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
  <div class="space-y-4">
    <article
      v-for="(entry, index) in rows"
      :key="`${entry.provider}-${String(index)}`"
      class="relative space-y-4 rounded-lg border bg-card p-4 pt-5 shadow-sm transition-all focus-within:ring-1 focus-within:ring-ring"
    >
      <div class="absolute right-2 top-2">
        <Button
          variant="ghost"
          size="icon"
          class="size-7 text-muted-foreground hover:text-destructive"
          type="button"
          :disabled="disabled"
          @click="removeEntry(index)"
          title="Remove provider"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </Button>
      </div>

      <div class="grid gap-4 md:grid-cols-3">
        <div class="grid gap-2">
          <label class="text-sm font-medium">Provider Name</label>
          <Input
            :model-value="entry.provider"
            :disabled="disabled"
            list="provider-config-provider-options"
            placeholder="e.g. openai"
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

        <template v-if="getEntryMode(entry) === 'proxy'">
          <div class="grid gap-2">
            <label class="text-sm font-medium">Base Provider</label>
            <Input
              :model-value="entry.baseProvider"
              :disabled="disabled"
              list="provider-config-provider-options"
              placeholder="e.g. openai"
              @update:model-value="(value) => patchEntry(index, { baseProvider: String(value) })"
            />
          </div>
        </template>
      </div>

      <template v-if="getEntryMode(entry) === 'proxy'">
        <div class="grid gap-2">
          <label class="text-sm font-medium"
            >Base URL <span class="text-muted-foreground font-normal ml-1">(Optional)</span></label
          >
          <Input
            :model-value="entry.baseUrl"
            :disabled="disabled"
            placeholder="https://proxy.example.com/v1"
            @update:model-value="(value) => patchEntry(index, { baseUrl: String(value) })"
          />
        </div>
      </template>

      <div class="grid gap-4 md:grid-cols-2">
        <div class="grid gap-2">
          <label class="text-sm font-medium"
            >API Key <span class="text-muted-foreground font-normal ml-1">(Optional)</span></label
          >
          <Input
            :model-value="entry.api_key"
            :disabled="disabled"
            type="password"
            placeholder="$env:OPENAI_API_KEY"
            @update:model-value="(value) => patchEntry(index, { api_key: String(value) })"
          />
        </div>

        <div class="grid gap-2">
          <label class="text-sm font-medium"
            >Env Variable
            <span class="text-muted-foreground font-normal ml-1">(Optional)</span></label
          >
          <Input
            :model-value="entry.apiKeyEnvVar"
            :disabled="disabled"
            placeholder="OPENAI_API_KEY"
            @update:model-value="(value) => patchEntry(index, { apiKeyEnvVar: String(value) })"
          />
        </div>
      </div>

      <template v-if="getEntryMode(entry) === 'proxy'">
        <div class="grid gap-2">
          <label class="text-sm font-medium flex items-center justify-between">
            <span>Model Mappings</span>
            <span class="text-xs text-muted-foreground font-normal"
              >Use comma separated values. Map with <code>source:target</code></span
            >
          </label>
          <Input
            :model-value="getMappingsText(entry)"
            :disabled="disabled"
            placeholder="gpt-4.1, gpt-4o:gpt-4o-mini"
            @update:model-value="(value) => setMappingsText(index, value)"
          />
        </div>
      </template>
    </article>

    <datalist id="provider-config-provider-options">
      <option v-for="option in providerOptions" :key="option" :value="option"></option>
    </datalist>

    <Button type="button" variant="outline" :disabled="disabled" @click="addEntry">
      Add Provider
    </Button>
  </div>
</template>
