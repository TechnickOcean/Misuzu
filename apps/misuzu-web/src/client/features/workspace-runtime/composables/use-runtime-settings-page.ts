import { computed, onMounted, reactive, ref, watch } from "vue"
import type {
  ProviderCatalogItem,
  ProviderConfigEntry,
  RuntimePlatformConfig,
} from "@shared/protocol.ts"
import { useRuntimeWorkspace } from "@/features/workspace-runtime/composables/use-runtime-workspace.ts"
import {
  createDefaultPluginConfigDraft,
  fromPluginConfig,
  toPluginConfig,
  type PluginConfigDraft,
} from "@/features/workspace-runtime/composables/plugin-config-form.ts"
import {
  createModelPoolRow,
  normalizeModelPoolRows,
  type ModelPoolRow,
} from "@/features/workspace-runtime/composables/model-pool-form.ts"
import { useRuntimeSettingsQuery } from "@/shared/composables/workspace-requests.ts"

export function useRuntimeSettingsPage(workspaceId: string) {
  const runtime = useRuntimeWorkspace(workspaceId)
  const runtimeSettingsQuery = useRuntimeSettingsQuery()
  runtimeSettingsQuery.paramsRef.value.workspaceId = workspaceId

  const settingsLoading = ref(false)
  const settingsError = ref("")

  const providerCatalog = ref<ProviderCatalogItem[]>([])
  const providerConfigDraft = ref<ProviderConfigEntry[]>([])
  const providerConfigSaving = ref(false)
  const providerConfigError = ref("")
  const providerConfigNotice = ref("")

  const modelPoolDraft = ref<ModelPoolRow[]>([])
  const modelPoolSaving = ref(false)
  const modelPoolError = ref("")
  const modelPoolNotice = ref("")

  const autoOrchestrateDraft = ref(false)
  const pluginIdDraft = ref("")
  const pluginConfigDraft = reactive<PluginConfigDraft>(createDefaultPluginConfigDraft())
  const solverPromptTemplateDraft = ref("")
  const runtimeConfigSaving = ref(false)
  const runtimeConfigError = ref("")
  const runtimeConfigNotice = ref("")

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
    modelPoolNotice.value = ""
    modelPoolSaving.value = true

    try {
      if (!snapshot.value?.paused) {
        throw new Error("Pause flow before updating model pool")
      }

      const normalized = normalizeModelPoolRows(modelPoolDraft.value)

      await runtime.updateModelPool(normalized)
      syncModelPoolDraftFromSnapshot()
      modelPoolNotice.value = "Model pool updated"
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
      await runtimeSettingsQuery.refetch(true)
      const settings = runtimeSettingsQuery.data.value
      if (!settings) {
        throw new Error("Runtime settings are unavailable")
      }

      providerCatalog.value = settings.providerCatalog
      providerConfigDraft.value = settings.providerConfig
      autoOrchestrateDraft.value = settings.autoOrchestrate

      pluginIdDraft.value = settings.platformConfig?.pluginId ?? ""
      Object.assign(pluginConfigDraft, fromPluginConfig(settings.platformConfig?.pluginConfig))
      solverPromptTemplateDraft.value = settings.platformConfig?.solverPromptTemplate ?? ""
    } catch (error) {
      settingsError.value = error instanceof Error ? error.message : String(error)
    } finally {
      settingsLoading.value = false
    }
  }

  async function saveProviderConfig() {
    providerConfigError.value = ""
    providerConfigNotice.value = ""
    providerConfigSaving.value = true
    try {
      await runtime.updateProviderConfig(providerConfigDraft.value)
      await loadSettings()
      providerConfigNotice.value = "providers.json saved"
    } catch (error) {
      providerConfigError.value = error instanceof Error ? error.message : String(error)
    } finally {
      providerConfigSaving.value = false
    }
  }

  async function saveRuntimeConfig() {
    runtimeConfigError.value = ""
    runtimeConfigNotice.value = ""
    runtimeConfigSaving.value = true
    try {
      const shouldInitializeAfterSave =
        snapshot.value?.setupPhase === "env_agent_ready_for_settings"
      let platformConfig: RuntimePlatformConfig | undefined
      if (pluginIdDraft.value.trim()) {
        platformConfig = {
          pluginId: pluginIdDraft.value.trim(),
          pluginConfig: toPluginConfig(pluginConfigDraft),
          solverPromptTemplate: solverPromptTemplateDraft.value,
        }
      }

      await runtime.updateRuntimeConfig({
        autoOrchestrate: autoOrchestrateDraft.value,
        platformConfig,
      })

      if (shouldInitializeAfterSave && platformConfig) {
        await runtime.initializeRuntime(platformConfig.pluginId, platformConfig.pluginConfig)
      }

      await loadSettings()
      runtimeConfigNotice.value = shouldInitializeAfterSave
        ? "Runtime config saved, plugin login succeeded, and setup is now ready"
        : "Runtime config saved"
    } catch (error) {
      runtimeConfigError.value = error instanceof Error ? error.message : String(error)
    } finally {
      runtimeConfigSaving.value = false
    }
  }

  return {
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
  }
}
