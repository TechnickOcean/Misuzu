import { readFileSync } from "node:fs"
import type { ProviderRegistry, ProxyProviderOptions } from "../../providers/registry.ts"
import type { Logger } from "../../../infrastructure/logging/types.ts"

interface ProviderConfigEntry {
  provider: string
  baseProvider?: string
  baseUrl?: string
  apiKeyEnvVar?: string
  api_key?: string
  apiKey?: string
  modelIds?: string[]
  modelMappings?: ProxyProviderOptions["modelMappings"]
}

export interface ProxyProviderBootstrapOptions {
  logger: Logger
  providers: ProviderRegistry
  providerConfigPath: string
  onProvidersLoaded?: () => void
}

export class ProxyProviderBootstrap {
  private loaded = false

  private readonly logger: Logger
  private readonly providers: ProviderRegistry
  private readonly providerConfigPath: string
  private readonly onProvidersLoaded?: () => void

  constructor(options: ProxyProviderBootstrapOptions) {
    this.logger = options.logger
    this.providers = options.providers
    this.providerConfigPath = options.providerConfigPath
    this.onProvidersLoaded = options.onProvidersLoaded
  }

  loadProviderConfigEntries() {
    try {
      const parsed = JSON.parse(readFileSync(this.providerConfigPath, "utf-8")) as unknown
      if (!Array.isArray(parsed)) {
        return []
      }

      return parsed
        .filter((entry): entry is ProviderConfigEntry => {
          if (!entry || typeof entry !== "object") {
            return false
          }

          const provider = (entry as { provider?: unknown }).provider
          return typeof provider === "string" && provider.trim().length > 0
        })
        .map((entry) => ({
          provider: entry.provider.trim(),
          baseProvider:
            typeof entry.baseProvider === "string" && entry.baseProvider.trim().length > 0
              ? entry.baseProvider.trim()
              : undefined,
          baseUrl: typeof entry.baseUrl === "string" ? entry.baseUrl : undefined,
          apiKeyEnvVar:
            typeof entry.apiKeyEnvVar === "string" && entry.apiKeyEnvVar.trim().length > 0
              ? entry.apiKeyEnvVar.trim()
              : undefined,
          api_key: typeof entry.api_key === "string" ? entry.api_key : undefined,
          apiKey: typeof entry.apiKey === "string" ? entry.apiKey : undefined,
          modelIds: Array.isArray(entry.modelIds)
            ? entry.modelIds.filter((item): item is string => typeof item === "string")
            : undefined,
          modelMappings: Array.isArray(entry.modelMappings)
            ? entry.modelMappings.filter(
                (item): item is NonNullable<ProxyProviderOptions["modelMappings"]>[number] =>
                  typeof item === "string" || (Boolean(item) && typeof item === "object"),
              )
            : undefined,
        }))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.logger.debug("providers.json is missing, skip loading proxy providers", {
          providerConfigPath: this.providerConfigPath,
        })
        return []
      }

      this.logger.error(
        "Failed to load workspace provider config",
        { providerConfigPath: this.providerConfigPath },
        error,
      )
      throw error
    }
  }

  loadProxyProviderOptions() {
    const proxyOptions: ProxyProviderOptions[] = []
    for (const entry of this.loadProviderConfigEntries()) {
      if (!entry.baseProvider) {
        continue
      }

      proxyOptions.push({
        provider: entry.provider,
        baseProvider: entry.baseProvider,
        baseUrl: entry.baseUrl,
        apiKeyEnvVar: entry.apiKeyEnvVar,
        api_key: entry.api_key,
        apiKey: entry.apiKey,
        modelIds: entry.modelIds,
        modelMappings: entry.modelMappings,
      })
    }

    return proxyOptions
  }

  bootstrap() {
    if (this.loaded) {
      this.logger.debug("Provider bootstrap skipped because it is already loaded")
      return []
    }

    this.providers.resetWorkspaceConfig()

    const entries = this.loadProviderConfigEntries()
    for (const entry of entries) {
      this.providers.registerProviderCredentials({
        provider: entry.provider,
        apiKeyEnvVar: entry.apiKeyEnvVar,
        api_key: entry.api_key,
        apiKey: entry.apiKey,
      })
    }

    const proxyOptions: ProxyProviderOptions[] = []
    for (const entry of entries) {
      if (!entry.baseProvider) {
        continue
      }

      proxyOptions.push({
        provider: entry.provider,
        baseProvider: entry.baseProvider,
        baseUrl: entry.baseUrl,
        apiKeyEnvVar: entry.apiKeyEnvVar,
        api_key: entry.api_key,
        apiKey: entry.apiKey,
        modelIds: entry.modelIds,
        modelMappings: entry.modelMappings,
      })
    }

    const registeredModels = this.providers.registerProxyProviders(proxyOptions)
    this.loaded = true
    this.logger.info("Provider bootstrap completed", {
      registeredModelCount: registeredModels.length,
    })

    this.onProvidersLoaded?.()

    return registeredModels
  }

  reload() {
    this.loaded = false
    this.logger.info("Provider config reload requested")
    return this.bootstrap()
  }
}
