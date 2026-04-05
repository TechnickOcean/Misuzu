import { readFileSync } from "node:fs"
import type { ProviderRegistry, ProxyProviderOptions } from "../../providers/index.ts"
import type { Logger } from "../../../infrastructure/logging/types.ts"

export interface ProxyProviderBootstrapOptions {
  logger: Logger
  providers: ProviderRegistry
  providerConfigPath: string
  logPrefix: string
  onProvidersLoaded?: () => void
}

export class ProxyProviderBootstrap {
  private loaded = false

  private readonly logger: Logger
  private readonly providers: ProviderRegistry
  private readonly providerConfigPath: string
  private readonly logPrefix: string
  private readonly onProvidersLoaded?: () => void

  constructor(options: ProxyProviderBootstrapOptions) {
    this.logger = options.logger
    this.providers = options.providers
    this.providerConfigPath = options.providerConfigPath
    this.logPrefix = options.logPrefix
    this.onProvidersLoaded = options.onProvidersLoaded
  }

  loadProxyProviderOptions() {
    try {
      return JSON.parse(readFileSync(this.providerConfigPath, "utf-8")) as ProxyProviderOptions[]
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.logger.debug(
          `${this.logPrefix} providers.json is missing, skip loading proxy providers`,
          {
            providerConfigPath: this.providerConfigPath,
          },
        )
        return []
      }

      this.logger.error(
        `${this.logPrefix} Failed to load workspace provider config`,
        { providerConfigPath: this.providerConfigPath },
        error,
      )
      throw error
    }
  }

  bootstrap() {
    if (this.loaded) {
      this.logger.debug(`${this.logPrefix} provider bootstrap skipped because it is already loaded`)
      return []
    }

    const registeredModels = this.providers.registerProxyProviders(this.loadProxyProviderOptions())
    this.loaded = true
    this.logger.info(`${this.logPrefix} Provider bootstrap completed`, {
      registeredModelCount: registeredModels.length,
    })

    this.onProvidersLoaded?.()

    return registeredModels
  }

  reload() {
    this.loaded = false
    this.logger.info(`${this.logPrefix} Provider config reload requested`)
    return this.bootstrap()
  }
}
