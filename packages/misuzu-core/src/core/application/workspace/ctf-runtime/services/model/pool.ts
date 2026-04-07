import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { getEnvApiKey, type Api, type Model } from "@mariozechner/pi-ai"
import type { ProviderRegistry } from "../../../../providers/registry.ts"
import type { Logger } from "../../../../../infrastructure/logging/types.ts"
import { resolveWorkspacePaths } from "../../../shared/paths.ts"

const MODEL_POOL_STATE_VERSION = "1.0.0"
const MODEL_POOL_CONFIG_FILE = "model-pool.json"

export type ModelPoolErrorCode =
  | "MODEL_POOL_EMPTY"
  | "MODEL_POOL_EXHAUSTED"
  | "MODEL_NOT_IN_POOL"
  | "MODEL_NOT_AVAILABLE"

export class ModelPoolError extends Error {
  readonly code: ModelPoolErrorCode

  constructor(code: ModelPoolErrorCode, message: string) {
    super(message)
    this.name = "ModelPoolError"
    this.code = code
  }
}

export interface ModelPoolItem {
  provider: string
  modelId: string
  maxConcurrency: number
}

export interface ModelPoolSnapshotItem extends ModelPoolItem {
  inUse: number
  available: number
  modelResolved: boolean
}

export interface ModelPoolStateSnapshot {
  items: ModelPoolSnapshotItem[]
  totalCapacity: number
  totalInUse: number
  totalAvailable: number
  hasAvailableModel: boolean
}

export interface ModelPoolCatalogModel {
  modelId: string
  modelName: string
}

export interface ModelPoolCatalogProvider {
  provider: string
  hasEnvApiKey: boolean
  models: ModelPoolCatalogModel[]
}

export interface ModelPoolLease {
  model: Model<Api>
  release: () => void
}

interface PersistedModelPoolConfig {
  version: string
  lastModified: string
  items: ModelPoolItem[]
}

export interface WorkspaceModelPoolDeps {
  rootDir: string
  logger: Logger
  providers: ProviderRegistry
}

export class WorkspaceModelPool {
  private readonly rootDir: string
  private readonly logger: Logger
  private readonly providers: ProviderRegistry

  private configFilePath = ""
  private items: ModelPoolItem[] = []
  private readonly inUseByModel = new Map<string, number>()

  constructor(deps: WorkspaceModelPoolDeps) {
    this.rootDir = deps.rootDir
    this.logger = deps.logger
    this.providers = deps.providers

    const paths = resolveWorkspacePaths(this.rootDir)
    this.configFilePath = join(paths.markerDir, MODEL_POOL_CONFIG_FILE)
  }

  async initialize() {
    const paths = resolveWorkspacePaths(this.rootDir)
    this.configFilePath = join(paths.markerDir, MODEL_POOL_CONFIG_FILE)
    await mkdir(paths.markerDir, { recursive: true })

    const persisted = await this.loadFromDisk()
    this.items = persisted?.items ?? []
  }

  getState() {
    const items = this.items.map((item) => {
      const inUse = this.inUseByModel.get(toModelKey(item.provider, item.modelId)) ?? 0
      const modelResolved = Boolean(this.providers.getModel(item.provider, item.modelId))
      const available = Math.max(0, item.maxConcurrency - inUse)

      return {
        ...item,
        inUse,
        available,
        modelResolved,
      }
    })

    const totalCapacity = items.reduce((sum, item) => sum + item.maxConcurrency, 0)
    const totalInUse = items.reduce((sum, item) => sum + item.inUse, 0)
    const totalAvailable = items
      .filter((item) => item.modelResolved)
      .reduce((sum, item) => sum + item.available, 0)

    return {
      items,
      totalCapacity,
      totalInUse,
      totalAvailable,
      hasAvailableModel: totalAvailable > 0,
    }
  }

  listCatalogProviders() {
    return this.providers.listProviders().map((provider) => {
      const models = this.providers.listModels(provider).map((model) => ({
        modelId: model.id,
        modelName: model.name,
      }))

      return {
        provider,
        hasEnvApiKey: Boolean(getEnvApiKey(provider) ?? this.providers.getApiKey(provider)),
        models,
      }
    })
  }

  async setItems(items: ModelPoolItem[]) {
    const normalizedItems = normalizeModelPoolItems(items)
    this.items = normalizedItems

    const paths = resolveWorkspacePaths(this.rootDir)
    await mkdir(paths.markerDir, { recursive: true })

    await this.saveToDisk({
      version: MODEL_POOL_STATE_VERSION,
      lastModified: new Date().toISOString(),
      items: normalizedItems,
    })
  }

  acquire(preferredModel?: { provider: string; modelId: string }): ModelPoolLease {
    if (this.items.length === 0) {
      throw new ModelPoolError(
        "MODEL_POOL_EMPTY",
        "Model pool is empty. Add at least one model before starting agents.",
      )
    }

    const preferredKey = preferredModel
      ? toModelKey(preferredModel.provider, preferredModel.modelId)
      : undefined

    if (preferredKey) {
      const preferredItem = this.items.find(
        (item) => toModelKey(item.provider, item.modelId) === preferredKey,
      )

      if (!preferredItem) {
        throw new ModelPoolError(
          "MODEL_NOT_IN_POOL",
          `Model ${preferredModel!.provider}/${preferredModel!.modelId} is not in model pool.`,
        )
      }
    }

    const candidates = preferredKey
      ? this.items.filter((item) => toModelKey(item.provider, item.modelId) === preferredKey)
      : this.items

    for (const item of candidates) {
      const model = this.providers.getModel(item.provider, item.modelId)
      if (!model) {
        continue
      }

      const key = toModelKey(item.provider, item.modelId)
      const inUse = this.inUseByModel.get(key) ?? 0
      if (inUse >= item.maxConcurrency) {
        continue
      }

      this.inUseByModel.set(key, inUse + 1)

      let released = false
      return {
        model,
        release: () => {
          if (released) {
            return
          }

          released = true
          const current = this.inUseByModel.get(key) ?? 0
          if (current <= 1) {
            this.inUseByModel.delete(key)
            return
          }

          this.inUseByModel.set(key, current - 1)
        },
      }
    }

    if (preferredModel) {
      const resolved = this.providers.getModel(preferredModel.provider, preferredModel.modelId)
      if (!resolved) {
        throw new ModelPoolError(
          "MODEL_NOT_AVAILABLE",
          `Model ${preferredModel.provider}/${preferredModel.modelId} cannot be resolved from provider registry.`,
        )
      }
    }

    throw new ModelPoolError(
      "MODEL_POOL_EXHAUSTED",
      "All model pool slots are currently in use. Increase concurrency or add models.",
    )
  }

  private async loadFromDisk() {
    try {
      const raw = await readFile(this.configFilePath, "utf-8")
      const parsed = JSON.parse(raw) as PersistedModelPoolConfig

      if (!Array.isArray(parsed.items)) {
        this.logger.warn("Invalid model pool config format: items must be an array")
        return undefined
      }

      return {
        version: typeof parsed.version === "string" ? parsed.version : MODEL_POOL_STATE_VERSION,
        lastModified:
          typeof parsed.lastModified === "string" ? parsed.lastModified : new Date().toISOString(),
        items: normalizeModelPoolItems(parsed.items),
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined
      }

      this.logger.error("Failed to load model pool config", { path: this.configFilePath }, error)
      throw error
    }
  }

  private async saveToDisk(state: PersistedModelPoolConfig) {
    await writeFile(this.configFilePath, JSON.stringify(state, null, 2), "utf-8")
  }
}

export function isModelPoolError(error: unknown): error is ModelPoolError {
  return error instanceof ModelPoolError
}

function normalizeModelPoolItems(items: ModelPoolItem[]) {
  const normalized: ModelPoolItem[] = []
  const seenKeys = new Set<string>()

  for (const item of items) {
    const provider = typeof item.provider === "string" ? item.provider.trim() : ""
    const modelId = typeof item.modelId === "string" ? item.modelId.trim() : ""

    if (!provider || !modelId) {
      throw new Error("Invalid model pool item: provider and modelId are required")
    }

    if (!Number.isInteger(item.maxConcurrency) || item.maxConcurrency <= 0) {
      throw new Error(
        `Invalid maxConcurrency for ${provider}/${modelId}: ${String(item.maxConcurrency)}`,
      )
    }

    const key = toModelKey(provider, modelId)
    if (seenKeys.has(key)) {
      throw new Error(`Duplicate model pool item detected: ${provider}/${modelId}`)
    }

    seenKeys.add(key)
    normalized.push({
      provider,
      modelId,
      maxConcurrency: item.maxConcurrency,
    })
  }

  return normalized
}

function toModelKey(provider: string, modelId: string) {
  return `${provider}:${modelId}`
}
