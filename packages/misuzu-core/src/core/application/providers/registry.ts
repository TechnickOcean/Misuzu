import {
  getModel as getBaseModel,
  getModels,
  getProviders,
  type Api,
  type Model,
} from "@mariozechner/pi-ai"
import { getOAuthApiKey, getOAuthProvider, type OAuthCredentials } from "@mariozechner/pi-ai/oauth"

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

interface RegisteredOAuthCredentials {
  oauthProvider: string
  credentials: OAuthCredentials
  autoRefresh: boolean
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

export interface OAuthProviderOptions {
  provider: string
  oauthProvider?: string
  credentials?: OAuthCredentials
  autoRefresh?: boolean
}

export interface OAuthCredentialsRefreshUpdate {
  provider: string
  oauthProvider: string
  credentials: OAuthCredentials
  autoRefresh: boolean
}

export class ProviderRegistry {
  private readonly proxyProviderRegistry = new Map<string, Map<string, Model<Api>>>()
  private readonly providerApiKeyEnvRegistry = new Map<string, string>()
  private readonly providerApiKeyRegistry = new Map<string, string>()
  private readonly oauthCredentialsRegistry = new Map<string, RegisteredOAuthCredentials>()
  private oauthCredentialsRefreshListener?: (
    update: OAuthCredentialsRefreshUpdate,
  ) => Promise<void> | void

  setOAuthCredentialsRefreshListener(
    listener?: (update: OAuthCredentialsRefreshUpdate) => Promise<void> | void,
  ) {
    this.oauthCredentialsRefreshListener = listener
  }

  resetWorkspaceConfig() {
    this.proxyProviderRegistry.clear()
    this.providerApiKeyEnvRegistry.clear()
    this.providerApiKeyRegistry.clear()
    this.oauthCredentialsRegistry.clear()
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
    const configuredApiKey = this.getConfiguredApiKey(provider, env)
    if (configuredApiKey !== undefined) {
      return configuredApiKey
    }

    return this.getOAuthApiKeyFromCache(provider)
  }

  async getApiKeyAsync(provider: string, env: NodeJS.ProcessEnv = process.env) {
    const configuredApiKey = this.getConfiguredApiKey(provider, env)
    if (configuredApiKey !== undefined) {
      return configuredApiKey
    }

    const registered = this.oauthCredentialsRegistry.get(provider)
    if (!registered) {
      return undefined
    }

    if (!registered.autoRefresh) {
      return this.getOAuthApiKeyFromCache(provider)
    }

    try {
      const refreshed = await getOAuthApiKey(registered.oauthProvider, {
        [registered.oauthProvider]: registered.credentials,
      })
      if (!refreshed) {
        return undefined
      }

      this.oauthCredentialsRegistry.set(provider, {
        ...registered,
        credentials: refreshed.newCredentials,
      })

      await this.notifyOAuthCredentialsRefresh(provider)

      return refreshed.apiKey
    } catch {
      return this.getOAuthApiKeyFromCache(provider)
    }
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

  registerOAuthCredentials(options: OAuthProviderOptions) {
    const provider = options.provider.trim()
    if (!provider) {
      return
    }

    const oauthProvider =
      typeof options.oauthProvider === "string" && options.oauthProvider.trim().length > 0
        ? options.oauthProvider.trim()
        : provider

    if (!options.credentials) {
      this.oauthCredentialsRegistry.delete(provider)
      return
    }

    this.oauthCredentialsRegistry.set(provider, {
      oauthProvider,
      credentials: options.credentials,
      autoRefresh: options.autoRefresh ?? true,
    })
  }

  getOAuthCredentials(provider: string): OAuthCredentials | undefined {
    return this.oauthCredentialsRegistry.get(provider)?.credentials
  }

  getOAuthProviderName(provider: string): string | undefined {
    return this.oauthCredentialsRegistry.get(provider)?.oauthProvider
  }

  isOAuthAutoRefreshEnabled(provider: string): boolean {
    return this.oauthCredentialsRegistry.get(provider)?.autoRefresh ?? false
  }

  hasOAuthCredentials(provider: string): boolean {
    return this.oauthCredentialsRegistry.has(provider)
  }

  removeOAuthCredentials(provider: string) {
    this.oauthCredentialsRegistry.delete(provider)
  }

  listOAuthProviders(): string[] {
    return [...this.oauthCredentialsRegistry.keys()]
  }

  private getConfiguredApiKey(provider: string, env: NodeJS.ProcessEnv) {
    const inlineApiKey = this.providerApiKeyRegistry.get(provider)
    if (inlineApiKey) {
      return inlineApiKey
    }

    const apiKeyEnvVar = this.providerApiKeyEnvRegistry.get(provider)
    return apiKeyEnvVar ? env[apiKeyEnvVar] : undefined
  }

  private getOAuthApiKeyFromCache(provider: string) {
    const registered = this.oauthCredentialsRegistry.get(provider)
    if (!registered) {
      return undefined
    }

    const oauthProvider = getOAuthProvider(registered.oauthProvider)
    if (!oauthProvider) {
      return undefined
    }

    try {
      return oauthProvider.getApiKey(registered.credentials)
    } catch {
      return undefined
    }
  }

  private async notifyOAuthCredentialsRefresh(provider: string) {
    const listener = this.oauthCredentialsRefreshListener
    const registered = this.oauthCredentialsRegistry.get(provider)
    if (!listener || !registered) {
      return
    }

    try {
      await listener({
        provider,
        oauthProvider: registered.oauthProvider,
        credentials: registered.credentials,
        autoRefresh: registered.autoRefresh,
      })
    } catch {
      // Ignore persistence callback failures to avoid breaking API key resolution.
    }
  }
}
