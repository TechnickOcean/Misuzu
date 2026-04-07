import {
  getModel as getBaseModel,
  getModels,
  getProviders,
  type Api,
  type Model,
} from "@mariozechner/pi-ai"

export interface ProxyProviderModelMapping {
  sourceModelId: string
  targetModelId?: string
  targetModelName?: string
}

export interface ProxyProviderOptions {
  provider: string
  baseProvider: string
  baseUrl?: string
  apiKeyEnvVar?: string
  api_key?: string
  apiKey?: string
  modelIds?: string[]
  modelMappings?: (string | ProxyProviderModelMapping)[]
}

function cloneProxyModel(
  sourceModel: Model<Api>,
  options: ProxyProviderOptions,
  mapping: ProxyProviderModelMapping,
) {
  const clone = {
    ...sourceModel,
    provider: options.provider,
    id: mapping.targetModelId ?? mapping.sourceModelId,
    name: mapping.targetModelName ?? sourceModel.name,
    baseUrl: options.baseUrl ?? sourceModel.baseUrl,
    input: [...sourceModel.input],
    cost: { ...sourceModel.cost },
  } as Model<Api>

  if (sourceModel.compat) {
    clone.compat = { ...sourceModel.compat }
  }

  return clone
}

function resolveModelMappings(options: ProxyProviderOptions, sourceModels: Model<Api>[]) {
  if (options.modelMappings && options.modelMappings.length > 0) {
    return options.modelMappings.map((mapping) => {
      if (typeof mapping === "string") {
        return {
          sourceModelId: mapping,
          targetModelId: mapping,
        }
      }

      return {
        sourceModelId: mapping.sourceModelId,
        targetModelId: mapping.targetModelId ?? mapping.sourceModelId,
        targetModelName: mapping.targetModelName,
      }
    })
  }

  const sourceModelIds =
    options.modelIds && options.modelIds.length > 0
      ? options.modelIds
      : sourceModels.map((model) => model.id)

  return sourceModelIds.map((modelId) => ({
    sourceModelId: modelId,
    targetModelId: modelId,
  }))
}

function getBuiltInModel(provider: string, modelId: string) {
  const resolver = getBaseModel as unknown as (
    providerName: string,
    modelName: string,
  ) => Model<Api> | undefined

  return resolver(provider, modelId)
}

export class ProviderRegistry {
  private readonly proxyProviderRegistry = new Map<string, Map<string, Model<Api>>>()
  private readonly providerApiKeyEnvRegistry = new Map<string, string>()
  private readonly providerApiKeyRegistry = new Map<string, string>()

  resetWorkspaceConfig() {
    this.proxyProviderRegistry.clear()
    this.providerApiKeyEnvRegistry.clear()
    this.providerApiKeyRegistry.clear()
  }

  registerProviderCredentials(options: {
    provider: string
    apiKeyEnvVar?: string
    apiKey?: string
    api_key?: string
  }) {
    const provider = options.provider.trim()
    if (!provider) {
      return
    }

    const inlineApiKey =
      typeof options.apiKey === "string" && options.apiKey.trim().length > 0
        ? options.apiKey.trim()
        : typeof options.api_key === "string" && options.api_key.trim().length > 0
          ? options.api_key.trim()
          : undefined
    const apiKeyEnvVar =
      typeof options.apiKeyEnvVar === "string" && options.apiKeyEnvVar.trim().length > 0
        ? options.apiKeyEnvVar.trim()
        : undefined

    if (apiKeyEnvVar) {
      this.providerApiKeyEnvRegistry.set(provider, apiKeyEnvVar)
    } else {
      this.providerApiKeyEnvRegistry.delete(provider)
    }

    if (inlineApiKey) {
      this.providerApiKeyRegistry.set(provider, inlineApiKey)
    } else {
      this.providerApiKeyRegistry.delete(provider)
    }
  }

  registerProxyProvider(options: ProxyProviderOptions) {
    const baseProviderModels = getModels(options.baseProvider as any) as Model<Api>[]
    const sourceModelById = new Map(baseProviderModels.map((model) => [model.id, model]))
    const mappings = resolveModelMappings(options, baseProviderModels)
    const providerModels = new Map<string, Model<Api>>()

    for (const mapping of mappings) {
      const sourceModel = sourceModelById.get(mapping.sourceModelId)
      if (!sourceModel) {
        continue
      }

      const proxyModel = cloneProxyModel(sourceModel, options, mapping)
      providerModels.set(proxyModel.id, proxyModel)
    }

    this.proxyProviderRegistry.set(options.provider, providerModels)
    this.registerProviderCredentials(options)

    return Array.from(providerModels.values())
  }

  registerProxyProviders(optionsList: ProxyProviderOptions[]) {
    const registeredModels: Model<Api>[] = []

    for (const options of optionsList) {
      registeredModels.push(...this.registerProxyProvider(options))
    }

    return registeredModels
  }

  getModel(provider: string, modelId: string) {
    return (
      this.proxyProviderRegistry.get(provider)?.get(modelId) ?? getBuiltInModel(provider, modelId)
    )
  }

  getApiKey(provider: string, env: NodeJS.ProcessEnv = process.env) {
    const inlineApiKey = this.providerApiKeyRegistry.get(provider)
    if (inlineApiKey) {
      return inlineApiKey
    }

    const apiKeyEnvVar = this.providerApiKeyEnvRegistry.get(provider)
    return apiKeyEnvVar ? env[apiKeyEnvVar] : undefined
  }

  listProviders() {
    return [...new Set([...getProviders(), ...this.proxyProviderRegistry.keys()])]
  }

  listModels(provider: string) {
    const proxyModels = this.proxyProviderRegistry.get(provider)
    if (proxyModels) {
      return [...proxyModels.values()]
    }

    try {
      return getModels(provider as any) as Model<Api>[]
    } catch {
      return []
    }
  }
}
