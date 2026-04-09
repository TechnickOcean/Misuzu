import { readFileSync, writeFileSync } from "node:fs"
import type { OAuthCredentials } from "@mariozechner/pi-ai/oauth"
import type {
  OAuthCredentialsRefreshUpdate,
  ProviderRegistry,
  ProxyProviderOptions,
} from "../../providers/registry.ts"
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
  oauthProvider?: string
  oauthCredentials?: OAuthCredentials
  oauthAutoRefresh?: boolean
}

function isOAuthCredentials(value: unknown): value is OAuthCredentials {
  if (!value || typeof value !== "object") {
    return false
  }

  const candidate = value as {
    refresh?: unknown
    access?: unknown
    expires?: unknown
  }

  return (
    typeof candidate.refresh === "string" &&
    typeof candidate.access === "string" &&
    typeof candidate.expires === "number" &&
    Number.isFinite(candidate.expires)
  )
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
    this.providers.setOAuthCredentialsRefreshListener((update) => {
      this.persistRefreshedOAuthCredentials(update)
    })
  }

  private readRawProviderConfigEntries() {
    try {
      const parsed = JSON.parse(readFileSync(this.providerConfigPath, "utf-8")) as unknown
      if (!Array.isArray(parsed)) {
        return []
      }

      return parsed
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return []
      }

      throw error
    }
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
          oauthProvider:
            typeof entry.oauthProvider === "string" && entry.oauthProvider.trim().length > 0
              ? entry.oauthProvider.trim()
              : undefined,
          oauthCredentials: isOAuthCredentials(entry.oauthCredentials)
            ? entry.oauthCredentials
            : undefined,
          oauthAutoRefresh:
            typeof entry.oauthAutoRefresh === "boolean" ? entry.oauthAutoRefresh : undefined,
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

      this.providers.registerOAuthCredentials({
        provider: entry.provider,
        oauthProvider: entry.oauthProvider,
        credentials: entry.oauthCredentials,
        autoRefresh: entry.oauthAutoRefresh,
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

  private persistRefreshedOAuthCredentials(update: OAuthCredentialsRefreshUpdate) {
    try {
      const entries = this.readRawProviderConfigEntries()
      const target = entries.find((entry) => {
        if (!entry || typeof entry !== "object") {
          return false
        }

        const provider = (entry as { provider?: unknown }).provider
        return typeof provider === "string" && provider.trim() === update.provider
      })

      if (!target || typeof target !== "object") {
        return
      }

      const entry = target as Record<string, unknown>
      const currentOAuthProvider =
        typeof entry.oauthProvider === "string" ? entry.oauthProvider : undefined
      const currentCredentials = entry.oauthCredentials
      const currentAutoRefresh =
        typeof entry.oauthAutoRefresh === "boolean" ? entry.oauthAutoRefresh : undefined

      const nextCredentials = update.credentials as Record<string, unknown>
      const credentialsChanged =
        JSON.stringify(currentCredentials) !== JSON.stringify(nextCredentials)
      const oauthProviderChanged = currentOAuthProvider !== update.oauthProvider
      const autoRefreshChanged = currentAutoRefresh !== update.autoRefresh
      if (!credentialsChanged && !oauthProviderChanged && !autoRefreshChanged) {
        return
      }

      entry.oauthProvider = update.oauthProvider
      entry.oauthCredentials = nextCredentials
      entry.oauthAutoRefresh = update.autoRefresh
      if (typeof entry.providerType !== "string") {
        entry.providerType = "oauth_provider"
      }

      writeFileSync(this.providerConfigPath, JSON.stringify(entries, null, 2), "utf-8")
      this.logger.debug("Persisted refreshed OAuth credentials", {
        provider: update.provider,
        oauthProvider: update.oauthProvider,
      })
    } catch (error) {
      this.logger.warn(
        "Failed to persist refreshed OAuth credentials",
        { provider: update.provider, providerConfigPath: this.providerConfigPath },
        error,
      )
    }
  }
}
