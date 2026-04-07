import { computed, onMounted, reactive, ref, watch } from "vue"
import { marked } from "marked"
import { useRouter } from "vue-router"
import type { ModelPoolInput, PluginCatalogItem, ProviderCatalogItem } from "@shared/protocol.ts"
import {
  createDefaultPluginConfigDraft,
  toPluginConfig,
  type AuthMode,
  type ContestMode,
  type PluginConfigDraft,
} from "@/features/workspace-runtime/composables/plugin-config-form.ts"
import { useRuntimeWorkspace } from "@/features/workspace-runtime/composables/use-runtime-workspace.ts"
import { useAppServices } from "@/shared/di/app-services.ts"

interface ModelPoolRow {
  id: string
  provider: string
  modelId: string
  maxConcurrency: string
}

export function useRuntimeOverviewPage(workspaceId: string) {
  const router = useRouter()
  const runtime = useRuntimeWorkspace(workspaceId)
  const { apiClient } = useAppServices()

  const plugins = ref<PluginCatalogItem[]>([])
  const selectedPluginId = ref("")
  const pluginReadmeHtml = ref("")
  const pluginComboboxOpen = ref(false)
  const pluginDraft = reactive<PluginConfigDraft>(createDefaultPluginConfigDraft())
  const initError = ref("")
  const modelPoolDraft = ref<ModelPoolRow[]>([])
  const modelPoolSaving = ref(false)
  const modelPoolError = ref("")
  const providerCatalog = ref<ProviderCatalogItem[]>([])
  const queueActionChallengeId = ref<number>()
  const queueActionError = ref("")

  const snapshot = computed(() => runtime.snapshot.value)
  const activeChallenges = computed(() =>
    (snapshot.value?.challenges ?? []).filter((challenge) => challenge.status === "active"),
  )
  const queuedChallenges = computed(() =>
    (snapshot.value?.challenges ?? []).filter((challenge) => challenge.status === "queued"),
  )
  const historyChallenges = computed(() =>
    (snapshot.value?.challenges ?? []).filter(
      (challenge) =>
        challenge.status === "solved" ||
        challenge.status === "blocked" ||
        challenge.status === "model_unassigned" ||
        challenge.status === "idle",
    ),
  )
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

  onMounted(async () => {
    await loadPlugins()
    providerCatalog.value = await apiClient.listProviderCatalog(workspaceId)
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

  watch(selectedPluginId, async (pluginId) => {
    if (!pluginId) {
      pluginReadmeHtml.value = ""
      return
    }

    await loadPluginReadme(pluginId)
    pluginComboboxOpen.value = false
  })

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

  async function initializeRuntime() {
    initError.value = ""

    try {
      if (!selectedPluginId.value) {
        throw new Error("Please select a plugin")
      }

      await runtime.initializeRuntime(selectedPluginId.value, toPluginConfig(pluginDraft))
      await runtime.syncChallenges()
    } catch (error) {
      initError.value = error instanceof Error ? error.message : String(error)
    }
  }

  function openSolverAgent(agentId: string) {
    void router.push({
      name: "runtime-agent",
      params: {
        id: workspaceId,
        agentId,
      },
    })
  }

  function setContestMode(value: string) {
    pluginDraft.contestMode = value as ContestMode
  }

  function setAuthMode(value: string) {
    pluginDraft.authMode = value as AuthMode
  }

  function badgeVariantForStatus(
    status: "active" | "queued" | "solved" | "blocked" | "idle" | "model_unassigned",
  ) {
    switch (status) {
      case "active":
        return "destructive"
      case "queued":
        return "secondary"
      case "model_unassigned":
        return "outline"
      case "solved":
        return "default"
      case "blocked":
        return "outline"
      case "idle":
        return "outline"
    }
  }

  function createModelPoolRow(input?: ModelPoolInput): ModelPoolRow {
    return {
      id: crypto.randomUUID(),
      provider: input?.provider ?? "openai",
      modelId: input?.modelId ?? "gpt-4.1",
      maxConcurrency: String(input?.maxConcurrency ?? 1),
    }
  }

  function syncModelPoolDraftFromSnapshot() {
    const items = snapshot.value?.modelPool.items ?? []
    modelPoolDraft.value = items.length
      ? items.map((item) => createModelPoolRow(item))
      : [createModelPoolRow()]
  }

  function addModelPoolRow() {
    modelPoolDraft.value.push(createModelPoolRow())
  }

  function listModelsForProvider(provider: string) {
    return providerCatalog.value.find((item) => item.provider === provider)?.models ?? []
  }

  function removeModelPoolRow(rowId: string) {
    if (modelPoolDraft.value.length <= 1) {
      return
    }

    modelPoolDraft.value = modelPoolDraft.value.filter((item) => item.id !== rowId)
  }

  async function applyModelPool() {
    modelPoolError.value = ""
    modelPoolSaving.value = true

    try {
      if (!snapshot.value?.paused) {
        throw new Error("Pause flow before updating model pool")
      }

      const normalized = modelPoolDraft.value.map((item) => {
        const provider = item.provider.trim()
        const modelId = item.modelId.trim()
        const maxConcurrency = Number(item.maxConcurrency)
        if (!provider || !modelId) {
          throw new Error("Model pool provider/model id cannot be empty")
        }

        if (!Number.isInteger(maxConcurrency) || maxConcurrency <= 0) {
          throw new Error("Model pool maxConcurrency must be a positive integer")
        }

        return {
          provider,
          modelId,
          maxConcurrency,
        }
      })

      await runtime.updateModelPool(normalized)
      syncModelPoolDraftFromSnapshot()
    } catch (error) {
      modelPoolError.value = error instanceof Error ? error.message : String(error)
    } finally {
      modelPoolSaving.value = false
    }
  }

  async function enqueueChallenge(challengeId: number) {
    queueActionError.value = ""
    queueActionChallengeId.value = challengeId
    try {
      await runtime.enqueueChallenge(challengeId)
    } catch (error) {
      queueActionError.value = error instanceof Error ? error.message : String(error)
    } finally {
      queueActionChallengeId.value = undefined
    }
  }

  async function dequeueChallenge(challengeId: number) {
    queueActionError.value = ""
    queueActionChallengeId.value = challengeId
    try {
      await runtime.dequeueChallenge(challengeId)
    } catch (error) {
      queueActionError.value = error instanceof Error ? error.message : String(error)
    } finally {
      queueActionChallengeId.value = undefined
    }
  }

  async function resetSolver(challengeId: number) {
    queueActionError.value = ""
    queueActionChallengeId.value = challengeId
    try {
      await runtime.resetSolver(challengeId)
    } catch (error) {
      queueActionError.value = error instanceof Error ? error.message : String(error)
    } finally {
      queueActionChallengeId.value = undefined
    }
  }

  return {
    runtime,
    snapshot,
    activeChallenges,
    queuedChallenges,
    historyChallenges,
    plugins,
    selectedPluginId,
    pluginReadmeHtml,
    pluginComboboxOpen,
    pluginDraft,
    initError,
    modelPoolDraft,
    modelPoolSaving,
    modelPoolError,
    providerOptions,
    selectedPlugin,
    selectedPluginLabel,
    queueActionChallengeId,
    queueActionError,
    loadPlugins,
    loadPluginReadme,
    initializeRuntime,
    openSolverAgent,
    setContestMode,
    setAuthMode,
    badgeVariantForStatus,
    syncModelPoolDraftFromSnapshot,
    addModelPoolRow,
    listModelsForProvider,
    removeModelPoolRow,
    applyModelPool,
    enqueueChallenge,
    dequeueChallenge,
    resetSolver,
  }
}
