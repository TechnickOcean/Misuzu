import { computed, onMounted, reactive, ref } from "vue"
import { useRouter } from "vue-router"
import type {
  ModelPoolInput,
  OAuthLoginSessionSnapshot,
  ProviderCatalogItem,
  ProviderConfigEntry,
} from "@shared/protocol.ts"
import {
  createDefaultPluginConfigDraft,
  toPluginConfig,
  type PluginConfigDraft,
} from "@/features/workspace-runtime/composables/plugin-config-form.ts"
import { DEFAULT_SOLVER_PROMPT_TEMPLATE } from "@/features/workspace-runtime/composables/solver-prompt-template.ts"
import {
  createModelPoolRow,
  normalizeModelPoolRows,
  type ModelPoolRow,
} from "@/features/workspace-runtime/composables/model-pool-form.ts"
import {
  useCreateRuntimeWorkspaceMutation,
  useProviderCatalogQuery,
  useStartRuntimeDispatchMutation,
} from "@/shared/composables/workspace-requests.ts"
import { useAppServices } from "@/shared/di/app-services.ts"

type ProviderConfigMode = "form" | "upload"

export function useCreateWorkspacePage() {
  const router = useRouter()
  const { apiClient } = useAppServices()

  const providerCatalogQuery = useProviderCatalogQuery()
  providerCatalogQuery.paramsRef.value.workspaceId = ""

  const createRuntimeWorkspaceMutation = useCreateRuntimeWorkspaceMutation()
  const startRuntimeDispatchMutation = useStartRuntimeDispatchMutation()

  const steps = ["Workspace", "Providers & Models", "Plugins", "Confirm"]
  const step = ref(1)
  const creating = ref(false)
  const formError = ref("")

  const name = ref("")
  const rootDir = ref("")

  const providerCatalog = computed<ProviderCatalogItem[]>(
    () => providerCatalogQuery.data.value ?? [],
  )
  const providerConfigMode = ref<ProviderConfigMode>("form")
  const providerConfigDraft = ref<ProviderConfigEntry[]>([])
  const providerConfigSaved = ref(false)
  const providerConfigError = ref("")
  const oauthProviderCatalog = ref<string[]>([])
  const oauthPendingIndex = ref<number | null>(null)
  const oauthActiveSession = ref<OAuthLoginSessionSnapshot | null>(null)
  const oauthManualInput = ref("")
  const oauthManualInputSubmitting = ref(false)

  const modelPool = ref<ModelPoolRow[]>([createModelPoolRow()])

  const selectedPluginId = ref("")
  const pluginDraft = reactive<PluginConfigDraft>(createDefaultPluginConfigDraft())
  const solverPromptTemplateDraft = ref(DEFAULT_SOLVER_PROMPT_TEMPLATE)
  const skipPluginSetup = ref(false)
  const startFlowAfterCreate = ref(false)
  const isSolverPromptTemplateDefault = computed(
    () => solverPromptTemplateDraft.value.trim() === DEFAULT_SOLVER_PROMPT_TEMPLATE,
  )

  const providerOptions = computed(() => {
    const set = new Set(providerCatalog.value.map((item) => item.provider))
    for (const entry of providerConfigDraft.value) {
      if (entry.provider?.trim()) {
        set.add(entry.provider.trim())
      }
    }
    return Array.from(set).sort((left, right) => left.localeCompare(right))
  })
  const baseProviderOptions = computed(() =>
    providerCatalog.value
      .map((item) => item.provider)
      .sort((left, right) => left.localeCompare(right)),
  )
  const oauthProviderOptions = computed(() => {
    const options = new Set(oauthProviderCatalog.value)
    for (const entry of providerConfigDraft.value) {
      if (entry.oauthProvider?.trim()) {
        options.add(entry.oauthProvider.trim())
      }
    }

    return [...options].sort((left, right) => left.localeCompare(right))
  })
  const oauthNeedsManualInput = computed(() => {
    if (!oauthActiveSession.value?.awaitingManualInput) {
      return false
    }

    return !isGitHubEnterpriseDomainPrompt(oauthActiveSession.value)
  })

  const normalizedModelPool = computed<ModelPoolInput[]>(() => {
    return modelPool.value.map((item) => ({
      provider: item.provider.trim(),
      modelId: item.modelId.trim(),
      maxConcurrency: Number(item.maxConcurrency),
    }))
  })

  onMounted(async () => {
    await Promise.all([
      providerCatalogQuery.refetch(true),
      apiClient.listOAuthProviders().then((items) => {
        oauthProviderCatalog.value = items
      }),
    ])
  })

  async function loginProviderOAuth(payload: { index: number; oauthProvider: string }) {
    providerConfigError.value = ""
    oauthPendingIndex.value = payload.index
    oauthActiveSession.value = null
    oauthManualInput.value = ""

    try {
      const started = await apiClient.startOAuthLogin(payload.oauthProvider)
      let session = started
      let manualPromptSignature = ""
      let githubDomainAutoSubmitted = false
      oauthActiveSession.value = session

      console.log("[misuzu-oauth] create start", {
        sessionId: session.id,
        provider: session.provider,
        status: session.status,
      })

      for (let i = 0; i < 240; i += 1) {
        if (i % 5 === 0) {
          console.log("[misuzu-oauth] create poll", {
            sessionId: session.id,
            iteration: i,
            status: session.status,
            awaitingManualInput: session.awaitingManualInput,
            latestEvent: session.debugEvents?.at(-1),
          })
        }

        if (session.awaitingManualInput) {
          if (isGitHubEnterpriseDomainPrompt(session) && !githubDomainAutoSubmitted) {
            githubDomainAutoSubmitted = true
            const configuredDomain =
              providerConfigDraft.value[payload.index]?.oauthEnterpriseDomain?.trim() ?? ""
            session = await apiClient.submitOAuthManualCode(session.id, configuredDomain)
            oauthActiveSession.value = session
            continue
          }

          const signature = JSON.stringify({
            id: session.id,
            instructions: session.instructions,
            placeholder: session.manualInputPlaceholder,
            allowEmpty: session.manualInputAllowEmpty,
          })
          if (signature !== manualPromptSignature) {
            manualPromptSignature = signature
            oauthManualInput.value = session.manualInputPlaceholder ?? ""
          }
        }

        if (session.status === "success") {
          if (!session.credentials) {
            throw new Error("OAuth completed but credentials were missing")
          }

          providerConfigDraft.value = providerConfigDraft.value.map((entry, index) => {
            if (index !== payload.index) {
              return entry
            }

            return {
              ...entry,
              providerType: "oauth_provider",
              oauthProvider: payload.oauthProvider,
              oauthCredentials: session.credentials,
              oauthAutoRefresh: true,
              api_key: undefined,
              apiKeyEnvVar: undefined,
              baseProvider: undefined,
              baseUrl: undefined,
              modelIds: undefined,
              modelMappings: undefined,
            }
          })
          providerConfigSaved.value = false
          oauthActiveSession.value = session
          oauthManualInput.value = ""
          console.log("[misuzu-oauth] create success", {
            sessionId: session.id,
            provider: payload.oauthProvider,
          })
          return
        }

        if (session.status === "error") {
          oauthActiveSession.value = session
          console.error("[misuzu-oauth] create error", {
            sessionId: session.id,
            provider: payload.oauthProvider,
            error: session.error,
            latestEvent: session.debugEvents?.at(-1),
          })
          throw new Error(session.error || "OAuth login failed")
        }

        await new Promise((resolve) => setTimeout(resolve, 1200))
        session = await apiClient.getOAuthLoginSession(session.id)
        oauthActiveSession.value = session
      }

      throw new Error("OAuth login timed out, please retry")
    } catch (error) {
      providerConfigError.value = error instanceof Error ? error.message : String(error)
    } finally {
      oauthPendingIndex.value = null
    }
  }

  async function submitOAuthManualInput() {
    const session = oauthActiveSession.value
    if (!session?.awaitingManualInput) {
      return
    }

    oauthManualInputSubmitting.value = true
    providerConfigError.value = ""
    try {
      const updated = await apiClient.submitOAuthManualCode(session.id, oauthManualInput.value)
      oauthActiveSession.value = updated
      oauthManualInput.value = ""
    } catch (error) {
      providerConfigError.value = error instanceof Error ? error.message : String(error)
    } finally {
      oauthManualInputSubmitting.value = false
    }
  }

  function isGitHubEnterpriseDomainPrompt(session: OAuthLoginSessionSnapshot | null) {
    if (!session) {
      return false
    }

    return (
      session.provider === "github-copilot" &&
      session.awaitingManualInput === true &&
      session.manualInputAllowEmpty === true &&
      !session.authUrl &&
      (session.instructions ?? "").includes("GitHub Enterprise URL/domain")
    )
  }

  function listModelsForProvider(provider: string) {
    const builtinModels =
      providerCatalog.value.find((item) => item.provider === provider)?.models ?? []

    if (builtinModels.length > 0) {
      return builtinModels
    }

    const draftEntry = providerConfigDraft.value.find((entry) => entry.provider === provider)
    if (!draftEntry) {
      return []
    }

    if (draftEntry.modelIds && draftEntry.modelIds.length > 0) {
      return draftEntry.modelIds.map((id) => ({ modelId: id, modelName: id }))
    }

    if (draftEntry.modelMappings && draftEntry.modelMappings.length > 0) {
      return draftEntry.modelMappings.map((mapping) => {
        if (typeof mapping === "string") {
          return { modelId: mapping, modelName: mapping }
        }
        const id = mapping.targetModelId || mapping.sourceModelId
        const name = mapping.targetModelName || mapping.targetModelId || mapping.sourceModelId
        return { modelId: id, modelName: name }
      })
    }

    if (draftEntry.baseProvider) {
      return (
        providerCatalog.value.find((item) => item.provider === draftEntry.baseProvider)?.models ??
        []
      )
    }

    return []
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

  async function importProviderConfigFile(file: File | undefined) {
    if (!file) {
      return
    }

    providerConfigError.value = ""
    formError.value = ""

    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as unknown
      if (!Array.isArray(parsed)) {
        throw new Error("providers.json must be a JSON array")
      }

      providerConfigDraft.value = parsed.filter(
        (entry): entry is ProviderConfigEntry => Boolean(entry) && typeof entry === "object",
      )
      providerConfigSaved.value = false
      providerConfigMode.value = "form"
    } catch (error) {
      providerConfigError.value =
        error instanceof Error ? error.message : "Failed to parse providers.json file"
    }
  }

  function markProviderConfigDirty(nextConfig: ProviderConfigEntry[]) {
    providerConfigDraft.value = nextConfig
    providerConfigSaved.value = false
  }

  async function saveProviderConfigDraft() {
    providerConfigError.value = ""

    try {
      validateProviderConfigDraft()
      providerConfigSaved.value = true
      await providerCatalogQuery.refetch(true)
    } catch (error) {
      providerConfigSaved.value = false
      providerConfigError.value = error instanceof Error ? error.message : String(error)
    }
  }

  function validateProviderConfigDraft() {
    if (providerConfigDraft.value.length === 0) {
      throw new Error("Please add at least one provider entry in providers.json")
    }

    for (const entry of providerConfigDraft.value) {
      if (!entry.provider?.trim()) {
        throw new Error("Provider name is required in providers.json entries")
      }
    }
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
      if (!name.value.trim()) {
        throw new Error("Workspace title is required")
      }

      if (!rootDir.value.trim()) {
        throw new Error("Workspace directory is required")
      }

      return
    }

    if (currentStep === 2) {
      if (!providerConfigSaved.value) {
        throw new Error("Save providers.json first before continuing")
      }

      validateProviderConfigDraft()
      void normalizeModelPoolRows(modelPool.value)
      return
    }

    if (currentStep === 3) {
      if (skipPluginSetup.value) {
        return
      }

      if (!selectedPluginId.value) {
        throw new Error("Please select a plugin")
      }

      void toPluginConfig(pluginDraft)
    }
  }

  function skipPluginSetupForNow() {
    skipPluginSetup.value = true
    nextStep()
  }

  function resetSolverPromptTemplateDraft() {
    solverPromptTemplateDraft.value = DEFAULT_SOLVER_PROMPT_TEMPLATE
  }

  async function createWorkspace() {
    creating.value = true
    formError.value = ""

    try {
      validateStep(3)

      const snapshot = await createRuntimeWorkspaceMutation.mutateAsync({
        name: name.value.trim(),
        rootDir: rootDir.value.trim(),
        providerConfig: providerConfigDraft.value,
        modelPool: normalizedModelPool.value,
        pluginId: skipPluginSetup.value ? undefined : selectedPluginId.value,
        pluginConfig: skipPluginSetup.value ? undefined : toPluginConfig(pluginDraft),
        solverPromptTemplate: skipPluginSetup.value
          ? undefined
          : (() => {
              const solverPromptTemplate = solverPromptTemplateDraft.value.trim()
              return solverPromptTemplate && solverPromptTemplate !== DEFAULT_SOLVER_PROMPT_TEMPLATE
                ? solverPromptTemplate
                : undefined
            })(),
        createEnvironmentAgent: skipPluginSetup.value,
      })

      if (startFlowAfterCreate.value && !skipPluginSetup.value) {
        await startRuntimeDispatchMutation.mutateAsync({
          workspaceId: snapshot.id,
          autoEnqueue: true,
        })
      }

      if (skipPluginSetup.value) {
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
    } catch (error) {
      formError.value = error instanceof Error ? error.message : String(error)
    } finally {
      creating.value = false
    }
  }

  function openHome() {
    void router.push({ name: "home" })
  }

  return {
    steps,
    step,
    creating,
    formError,
    name,
    rootDir,
    providerCatalog,
    providerConfigMode,
    providerConfigDraft,
    providerConfigSaved,
    providerConfigError,
    oauthProviderOptions,
    oauthPendingIndex,
    oauthActiveSession,
    oauthNeedsManualInput,
    oauthManualInput,
    oauthManualInputSubmitting,
    modelPool,
    selectedPluginId,
    pluginDraft,
    solverPromptTemplateDraft,
    isSolverPromptTemplateDefault,
    resetSolverPromptTemplateDraft,
    skipPluginSetup,
    startFlowAfterCreate,
    providerOptions,
    baseProviderOptions,
    normalizedModelPool,
    listModelsForProvider,
    addModelPoolRow,
    removeModelPoolRow,
    importProviderConfigFile,
    markProviderConfigDirty,
    loginProviderOAuth,
    submitOAuthManualInput,
    saveProviderConfigDraft,
    nextStep,
    previousStep,
    skipPluginSetupForNow,
    createWorkspace,
    openHome,
  }
}
