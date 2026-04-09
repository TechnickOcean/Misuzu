<script setup lang="ts">
import { computed } from "vue"
import { CheckIcon, ChevronsUpDownIcon } from "lucide-vue-next"
import type { ProviderConfigEntry } from "@shared/protocol.ts"
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
  ComboboxTrigger,
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

type ProviderType = "custom_provider" | "normal_provider" | "oauth_provider"

const props = withDefaults(
  defineProps<{
    modelValue: ProviderConfigEntry[]
    disabled?: boolean
    providerOptions?: string[]
    baseProviderOptions?: string[]
    oauthProviderOptions?: string[]
    oauthPendingIndex?: number | null
  }>(),
  {
    disabled: false,
    providerOptions: () => [],
    baseProviderOptions: () => [],
    oauthProviderOptions: () => [],
    oauthPendingIndex: null,
  },
)

const emit = defineEmits<{
  (event: "update:modelValue", payload: ProviderConfigEntry[]): void
  (event: "oauth-login", payload: { index: number; oauthProvider: string }): void
}>()

const rows = computed(() => props.modelValue)

function addEntry() {
  emit("update:modelValue", [
    ...rows.value,
    {
      providerType: "normal_provider",
      provider: "",
      apiKeyEnvVar: "",
      api_key: "$env:OPENAI_API_KEY",
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

function getEntryType(entry: ProviderConfigEntry): ProviderType {
  if (
    entry.providerType === "custom_provider" ||
    entry.providerType === "normal_provider" ||
    entry.providerType === "oauth_provider"
  ) {
    return entry.providerType
  }

  if (entry.oauthCredentials || entry.oauthProvider) {
    return "oauth_provider"
  }

  if (entry.baseProvider) {
    return "custom_provider"
  }

  return "normal_provider"
}

function setEntryType(index: number, nextType: string) {
  const type: ProviderType =
    nextType === "custom_provider" || nextType === "oauth_provider" ? nextType : "normal_provider"

  const current = rows.value[index]
  if (!current) {
    return
  }

  if (type === "custom_provider") {
    patchEntry(index, {
      providerType: type,
      baseProvider: current.baseProvider?.trim() || "openai",
      oauthProvider: undefined,
      oauthCredentials: undefined,
      oauthAutoRefresh: undefined,
    })
    return
  }

  if (type === "oauth_provider") {
    const defaultOauthProvider =
      current.oauthProvider?.trim() ||
      current.provider?.trim() ||
      props.oauthProviderOptions[0] ||
      ""

    patchEntry(index, {
      providerType: type,
      baseProvider: undefined,
      baseUrl: undefined,
      modelIds: undefined,
      modelMappings: undefined,
      apiKeyEnvVar: undefined,
      api_key: undefined,
      oauthProvider: defaultOauthProvider,
      oauthAutoRefresh: true,
    })
    return
  }

  patchEntry(index, {
    providerType: type,
    baseProvider: undefined,
    baseUrl: undefined,
    modelIds: undefined,
    modelMappings: undefined,
    oauthProvider: undefined,
    oauthCredentials: undefined,
    oauthAutoRefresh: undefined,
  })
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

function listBaseProviderOptions(current: string | undefined) {
  const options = new Set(props.baseProviderOptions)
  const normalized = current?.trim()
  if (normalized) {
    options.add(normalized)
  }

  return [...options].sort((left, right) => left.localeCompare(right))
}

function listProviderOptions(current: string | undefined) {
  const options = new Set(props.providerOptions)
  const normalized = current?.trim()
  if (normalized) {
    options.add(normalized)
  }

  return [...options].sort((left, right) => left.localeCompare(right))
}

function listOAuthProviderOptions(current: string | undefined) {
  const options = new Set(props.oauthProviderOptions)
  const normalized = current?.trim()
  if (normalized) {
    options.add(normalized)
  }

  return [...options].sort((left, right) => left.localeCompare(right))
}

function triggerOAuthLogin(index: number, entry: ProviderConfigEntry) {
  const oauthProvider = entry.oauthProvider?.trim() || entry.provider?.trim()
  if (!oauthProvider) {
    return
  }

  emit("oauth-login", { index, oauthProvider })
}

function formatExpireTime(expiresAt: number | undefined) {
  if (!expiresAt || !Number.isFinite(expiresAt)) {
    return "unknown"
  }

  return new Date(expiresAt).toLocaleString()
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
          <Combobox
            :model-value="entry.provider"
            :disabled="disabled"
            @update:model-value="(value) => patchEntry(index, { provider: String(value ?? '') })"
          >
            <ComboboxAnchor class="w-full">
              <ComboboxTrigger as-child>
                <Button
                  type="button"
                  variant="outline"
                  class="w-full justify-between font-normal"
                  :disabled="disabled"
                >
                  <span class="truncate">{{ entry.provider || "Select provider" }}</span>
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
                    v-for="option in listProviderOptions(entry.provider)"
                    :key="option"
                    :value="option"
                    class="justify-between"
                  >
                    <span class="truncate">{{ option }}</span>
                    <ComboboxItemIndicator>
                      <CheckIcon class="size-4" />
                    </ComboboxItemIndicator>
                  </ComboboxItem>
                </ComboboxGroup>
              </ComboboxViewport>
            </ComboboxList>
          </Combobox>
        </div>

        <div class="grid gap-2">
          <label class="text-sm font-medium">Provider Type</label>
          <Select
            :model-value="getEntryType(entry)"
            @update:model-value="(value) => setEntryType(index, value)"
          >
            <SelectTrigger>
              <SelectValue placeholder="Select provider type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="normal_provider">normal_provider</SelectItem>
              <SelectItem value="custom_provider">custom_provider</SelectItem>
              <SelectItem value="oauth_provider">oauth_provider</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <template v-if="getEntryType(entry) === 'custom_provider'">
          <div class="grid gap-2">
            <label class="text-sm font-medium">Base Provider</label>
            <Combobox
              :model-value="entry.baseProvider ?? ''"
              :disabled="disabled"
              @update:model-value="
                (value) => patchEntry(index, { baseProvider: String(value ?? '') })
              "
            >
              <ComboboxAnchor class="w-full">
                <ComboboxTrigger as-child>
                  <Button
                    type="button"
                    variant="outline"
                    class="w-full justify-between font-normal"
                    :disabled="disabled"
                  >
                    <span class="truncate">{{ entry.baseProvider || "Select base provider" }}</span>
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
                      v-for="option in listBaseProviderOptions(entry.baseProvider)"
                      :key="option"
                      :value="option"
                      class="justify-between"
                    >
                      <span class="truncate">{{ option }}</span>
                      <ComboboxItemIndicator>
                        <CheckIcon class="size-4" />
                      </ComboboxItemIndicator>
                    </ComboboxItem>
                  </ComboboxGroup>
                </ComboboxViewport>
              </ComboboxList>
            </Combobox>
          </div>
        </template>

        <template v-if="getEntryType(entry) === 'oauth_provider'">
          <div class="grid gap-2">
            <label class="text-sm font-medium">OAuth Provider</label>
            <Combobox
              :model-value="entry.oauthProvider ?? ''"
              :disabled="disabled"
              @update:model-value="
                (value) => patchEntry(index, { oauthProvider: String(value ?? '') })
              "
            >
              <ComboboxAnchor class="w-full">
                <ComboboxTrigger as-child>
                  <Button
                    type="button"
                    variant="outline"
                    class="w-full justify-between font-normal"
                    :disabled="disabled"
                  >
                    <span class="truncate">{{
                      entry.oauthProvider || "Select OAuth provider"
                    }}</span>
                    <ChevronsUpDownIcon class="size-4 shrink-0 opacity-50" />
                  </Button>
                </ComboboxTrigger>
              </ComboboxAnchor>

              <ComboboxList class="w-(--reka-popper-anchor-width) p-0">
                <ComboboxInput placeholder="Search OAuth provider..." />
                <ComboboxEmpty>No provider found.</ComboboxEmpty>
                <ComboboxViewport>
                  <ComboboxGroup>
                    <ComboboxItem
                      v-for="oauthProvider in listOAuthProviderOptions(entry.oauthProvider)"
                      :key="oauthProvider"
                      :value="oauthProvider"
                      class="justify-between"
                    >
                      <span class="truncate">{{ oauthProvider }}</span>
                      <ComboboxItemIndicator>
                        <CheckIcon class="size-4" />
                      </ComboboxItemIndicator>
                    </ComboboxItem>
                  </ComboboxGroup>
                </ComboboxViewport>
              </ComboboxList>
            </Combobox>
          </div>
        </template>
      </div>

      <template v-if="getEntryType(entry) === 'custom_provider'">
        <div class="grid gap-2">
          <label class="text-sm font-medium"
            >Base URL <span class="ml-1 font-normal text-muted-foreground">(Optional)</span></label
          >
          <Input
            :model-value="entry.baseUrl"
            :disabled="disabled"
            placeholder="https://proxy.example.com/v1"
            @update:model-value="(value) => patchEntry(index, { baseUrl: String(value) })"
          />
        </div>
      </template>

      <template v-if="getEntryType(entry) === 'oauth_provider'">
        <div class="grid gap-2 md:grid-cols-[1fr_auto] md:items-end">
          <div class="text-xs text-muted-foreground">
            <p v-if="entry.oauthCredentials">
              OAuth token is ready. Expires at
              {{ formatExpireTime(entry.oauthCredentials.expires) }}.
            </p>
            <p v-else>Click login to authorize this provider.</p>
          </div>

          <Button
            type="button"
            variant="outline"
            :disabled="
              disabled || oauthPendingIndex === index || !(entry.oauthProvider || entry.provider)
            "
            @click="triggerOAuthLogin(index, entry)"
          >
            {{
              oauthPendingIndex === index
                ? "Authorizing..."
                : entry.oauthCredentials
                  ? "Re-authorize"
                  : "OAuth Login"
            }}
          </Button>
        </div>
      </template>

      <div v-if="getEntryType(entry) !== 'oauth_provider'" class="grid gap-4 md:grid-cols-2">
        <div class="grid gap-2">
          <label class="text-sm font-medium"
            >API Key <span class="ml-1 font-normal text-muted-foreground">(Optional)</span></label
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
            <span class="ml-1 font-normal text-muted-foreground">(Optional)</span></label
          >
          <Input
            :model-value="entry.apiKeyEnvVar"
            :disabled="disabled"
            placeholder="OPENAI_API_KEY"
            @update:model-value="(value) => patchEntry(index, { apiKeyEnvVar: String(value) })"
          />
        </div>
      </div>

      <template v-if="getEntryType(entry) === 'custom_provider'">
        <div class="grid gap-2">
          <label class="flex items-center justify-between text-sm font-medium">
            <span>Model Mappings</span>
            <span class="text-xs font-normal text-muted-foreground"
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

    <div class="flex flex-wrap items-center justify-between gap-2">
      <Button type="button" variant="outline" :disabled="disabled" @click="addEntry">
        Add Provider
      </Button>

      <div v-if="$slots.actions" class="flex items-center gap-2">
        <slot name="actions" />
      </div>
    </div>
  </div>
</template>
