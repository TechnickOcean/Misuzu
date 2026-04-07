import { computed, onMounted, reactive, ref, watch } from "vue"
import { marked } from "marked"
import { useRouter } from "vue-router"
import type {
  ModelPoolInput,
  PluginCatalogItem,
  ProviderCatalogItem,
  ProviderConfigEntry,
  WorkspaceKind,
} from "@shared/protocol.ts"
import {
  createDefaultPluginConfigDraft,
  toPluginConfig,
  type AuthMode,
  type ContestMode,
  type PluginConfigDraft,
} from "@/features/workspace-runtime/composables/plugin-config-form.ts"
import { useWorkspaceRegistryStore } from "@/features/workspace-registry/stores/workspace-registry-store.ts"
import { useAppServices } from "@/shared/di/app-services.ts"

interface ModelPoolRow {
  id: string
  provider: string
  modelId: string
  maxConcurrency: string
}

export function useCreateWorkspacePage() {
  const router = useRouter()

  const appServices = useAppServices()
  const { apiClient } = appServices
  const registryStore = useWorkspaceRegistryStore()
  registryStore.bindServices(appServices)

  const steps = ["Workspace", "Configuration", "Review"]
  const step = ref(1)
  const creating = ref(false)
  const formError = ref("")

  const kind = ref<WorkspaceKind>("ctf-runtime")
  const name = ref("")
  const rootDir = ref("")

  const runtimeWithPlugin = ref(true)
  const runtimeAutoOrchestrate = ref(false)
  const providerCatalog = ref<ProviderCatalogItem[]>([])
  const modelPool = ref<ModelPoolRow[]>([createModelPoolRow()])
  const providerConfigEnabled = ref(false)
  const providerConfigDraft = ref<ProviderConfigEntry[]>([])

  const plugins = ref<PluginCatalogItem[]>([])
  const selectedPluginId = ref("")
  const pluginReadmeHtml = ref("")
  const pluginComboboxOpen = ref(false)

  const pluginDraft = reactive<PluginConfigDraft>(createDefaultPluginConfigDraft())

  const solverProvider = ref("openai")
  const solverModelId = ref("gpt-4.1")
  const solverSystemPrompt = ref("")

  const selectedPlugin = computed(() =>
    plugins.value.find((plugin) => plugin.id === selectedPluginId.value),
  )
  const providerOptions = computed(() =>
    providerCatalog.value
      .map((item) => item.provider)
      .sort((left, right) => left.localeCompare(right)),
  )
  const selectedPluginLabel = computed(() => {
    const plugin = selectedPlugin.value
    if (!plugin) {
      return "Select plugin"
    }

    return `${plugin.name} (${plugin.id})`
  })

  const normalizedModelPool = computed<ModelPoolInput[]>(() => {
    return modelPool.value.map((item) => ({
      provider: item.provider.trim(),
      modelId: item.modelId.trim(),
      maxConcurrency: Number(item.maxConcurrency),
    }))
  })

  onMounted(async () => {
    providerCatalog.value = await apiClient.listProviderCatalog()
    await loadPlugins()
  })

  watch(selectedPluginId, async (pluginId) => {
    if (!pluginId) {
      pluginReadmeHtml.value = ""
      return
    }

    await loadPluginReadme(pluginId)
    pluginComboboxOpen.value = false
  })

  function createModelPoolRow(): ModelPoolRow {
    const fallbackProvider = providerCatalog.value[0]?.provider ?? "openai"
    const fallbackModelId = providerCatalog.value[0]?.models[0]?.modelId ?? "gpt-4.1"

    return {
      id: crypto.randomUUID(),
      provider: fallbackProvider,
      modelId: fallbackModelId,
      maxConcurrency: "1",
    }
  }

  function listModelsForProvider(provider: string) {
    return providerCatalog.value.find((item) => item.provider === provider)?.models ?? []
  }

  async function loadPlugins() {
    plugins.value = await apiClient.listPlugins()

    if (!selectedPluginId.value && plugins.value.length > 0) {
      selectedPluginId.value = plugins.value[0].id
      return
    }

    if (!plugins.value.some((plugin) => plugin.id === selectedPluginId.value)) {
      selectedPluginId.value = plugins.value[0]?.id ?? ""
    }
  }

  async function loadPluginReadme(pluginId: string) {
    const readme = await apiClient.getPluginReadme(pluginId)
    pluginReadmeHtml.value = await marked.parse(readme.markdown)
  }

  function addModelPoolRow() {
    modelPool.value.push(createModelPoolRow())
  }

  function removeModelPoolRow(rowId: string) {
    if (modelPool.value.length <= 1) {
      return
    }

    modelPool.value = modelPool.value.filter((item) => item.id !== rowId)
  }

  function nextStep() {
    formError.value = ""
    try {
      validateStep(step.value)
      step.value = Math.min(steps.length, step.value + 1)
    } catch (error) {
      formError.value = error instanceof Error ? error.message : String(error)
    }
  }

  function previousStep() {
    formError.value = ""
    step.value = Math.max(1, step.value - 1)
  }

  function validateStep(currentStep: number) {
    if (currentStep === 1) {
      return
    }

    if (kind.value === "ctf-runtime") {
      validateRuntimeConfig()
      return
    }

    if (!solverProvider.value.trim() || !solverModelId.value.trim()) {
      throw new Error("Solver provider and model id are required")
    }
  }

  function validateRuntimeConfig() {
    if (normalizedModelPool.value.length === 0) {
      throw new Error("At least one model pool item is required")
    }

    for (const model of normalizedModelPool.value) {
      if (!model.provider || !model.modelId) {
        throw new Error("Model pool provider/model id cannot be empty")
      }

      if (!Number.isFinite(model.maxConcurrency) || model.maxConcurrency <= 0) {
        throw new Error("Model pool maxConcurrency must be a positive number")
      }
    }

    if (!runtimeWithPlugin.value) {
      return
    }

    if (!selectedPluginId.value) {
      throw new Error("Please select a plugin")
    }

    void toPluginConfig(pluginDraft)
  }

  async function createWorkspace() {
    creating.value = true
    formError.value = ""

    try {
      validateStep(2)

      if (kind.value === "ctf-runtime") {
        const snapshot = await registryStore.createRuntimeWorkspace({
          name: name.value,
          rootDir: rootDir.value,
          providerConfig: providerConfigEnabled.value ? providerConfigDraft.value : undefined,
          modelPool: normalizedModelPool.value,
          pluginId: runtimeWithPlugin.value ? selectedPluginId.value : undefined,
          pluginConfig: runtimeWithPlugin.value ? toPluginConfig(pluginDraft) : undefined,
          autoOrchestrate: runtimeAutoOrchestrate.value,
          createEnvironmentAgent: !runtimeWithPlugin.value,
        })

        if (!runtimeWithPlugin.value) {
          await router.push({
            name: "runtime-agent",
            params: {
              id: snapshot.id,
              agentId: "environment",
            },
          })
          return
        }

        await router.push({
          name: "runtime-overview",
          params: {
            id: snapshot.id,
          },
        })
        return
      }

      const solverSnapshot = await registryStore.createSolverWorkspace({
        name: name.value,
        rootDir: rootDir.value,
        providerConfig: providerConfigEnabled.value ? providerConfigDraft.value : undefined,
        model: {
          provider: solverProvider.value,
          modelId: solverModelId.value,
        },
        systemPrompt: solverSystemPrompt.value.trim() || undefined,
      })

      await router.push({
        name: "solver",
        params: {
          id: solverSnapshot.id,
        },
      })
    } catch (error) {
      formError.value = error instanceof Error ? error.message : String(error)
    } finally {
      creating.value = false
    }
  }

  function openHome() {
    void router.push({ name: "home" })
  }

  function setContestMode(value: string) {
    pluginDraft.contestMode = value as ContestMode
  }

  function setAuthMode(value: string) {
    pluginDraft.authMode = value as AuthMode
  }

  return {
    steps,
    step,
    creating,
    formError,
    kind,
    name,
    rootDir,
    runtimeWithPlugin,
    runtimeAutoOrchestrate,
    providerCatalog,
    modelPool,
    providerConfigEnabled,
    providerConfigDraft,
    plugins,
    selectedPluginId,
    pluginReadmeHtml,
    pluginComboboxOpen,
    pluginDraft,
    solverProvider,
    solverModelId,
    solverSystemPrompt,
    selectedPlugin,
    providerOptions,
    selectedPluginLabel,
    normalizedModelPool,
    listModelsForProvider,
    loadPlugins,
    loadPluginReadme,
    addModelPoolRow,
    removeModelPoolRow,
    nextStep,
    previousStep,
    createWorkspace,
    openHome,
    setContestMode,
    setAuthMode,
  }
}
