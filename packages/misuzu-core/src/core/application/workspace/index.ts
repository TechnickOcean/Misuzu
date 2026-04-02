import { readFileSync } from "node:fs"
import { loadAgentSkills } from "../../../agents/features/skill.ts"
import { CoordinatorAgent, type CoordinatorAgentOptions } from "../../../agents/coordinator.ts"
import { AgentStateProxy } from "../../../agents/features/agent-state-proxy.ts"
import { SolverAgent, type SolverAgentOptions } from "../../../agents/solver.ts"
import { createContainer, type Container } from "../../infrastructure/di/container.ts"
import {
  loggerToken,
  persistenceStoreToken,
  providerRegistryToken,
} from "../../infrastructure/di/tokens.ts"
import { createWorkspaceLogger, getLogLevelFromEnv } from "../../infrastructure/logging/logger.ts"
import { ConsoleLogSink } from "../../infrastructure/logging/sinks/console-sink.ts"
import type { Logger } from "../../infrastructure/logging/types.ts"
import type { PersistedSolverAgentMeta, PersistenceStore } from "../persistence/store.ts"
import { JsonFilePersistenceAdapter } from "../persistence/json-adapter.ts"
import { ProviderRegistry, type ProxyProviderOptions } from "../providers/index.ts"
import { resolveWorkspacePaths } from "./paths.ts"

const workspaceRegistry = new Map<string, Workspace>()

export interface WorkspaceOptions {
  rootDir?: string
  configureContainer?: (container: Container) => void
}

export interface CreateSolverMainAgentOptions extends SolverAgentOptions {
  kind: "solver"
}

export interface CreateCoordinatorMainAgentOptions extends CoordinatorAgentOptions {
  kind: "coordinator"
}

export type CreateMainAgentOptions =
  | CreateSolverMainAgentOptions
  | CreateCoordinatorMainAgentOptions

export type MainAgent = SolverAgent | CoordinatorAgent

export class Workspace {
  readonly rootDir: string
  readonly markerDir: string
  readonly skillsRootDir: string
  readonly providerConfigPath: string

  mainAgent?: MainAgent
  private readonly container: Container
  private proxyProvidersLoaded = false
  private agentStateProxy?: AgentStateProxy
  private unsubscribeAgentTracking?: () => void

  constructor(rootDir: string, container: Container) {
    const paths = resolveWorkspacePaths(rootDir)
    this.rootDir = paths.rootDir
    this.markerDir = paths.markerDir
    this.skillsRootDir = paths.skillsRootDir
    this.providerConfigPath = paths.providerConfigPath
    this.container = container
  }

  async initPersistence() {
    const persistence = this.persistence
    await persistence.initialize(this.rootDir)

    const hasPersistedState = await persistence.hasPersistedState()
    if (hasPersistedState) {
      await this.restoreFromPersistence()
    }
  }

  get providers(): ProviderRegistry {
    return this.container.resolve(providerRegistryToken)
  }

  get persistence(): PersistenceStore {
    return this.container.resolve(persistenceStoreToken)
  }

  get logger(): Logger {
    return this.container.resolve(loggerToken)
  }

  loadProxyProviderOptions() {
    try {
      return JSON.parse(readFileSync(this.providerConfigPath, "utf-8")) as ProxyProviderOptions[]
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.logger.debug("[Workspace] providers.json is missing, skip loading proxy providers", {
          providerConfigPath: this.providerConfigPath,
        })
        return []
      }

      this.logger.error(
        "[Workspace] Failed to load workspace provider config",
        { providerConfigPath: this.providerConfigPath },
        error,
      )
      throw error
    }
  }

  bootstrap() {
    if (this.proxyProvidersLoaded) {
      this.logger.debug("[Workspace] bootstrap skipped because it is already loaded")
      return []
    }

    const registeredModels = this.providers.registerProxyProviders(this.loadProxyProviderOptions())
    this.proxyProvidersLoaded = true
    this.logger.info("Workspace bootstrap completed", {
      registeredModelCount: registeredModels.length,
    })

    const persistence = this.persistence
    if (persistence) {
      void this.safePersist(() => persistence.recordChange({ type: "providers-loaded" }))
    }

    return registeredModels
  }

  private safePersist(action: () => Promise<void>) {
    return action().catch((error) => {
      if ((error as Error).message === "PersistenceStore not initialized") {
        return
      }
      this.logger.warn("[Workspace] Failed to persist change", error)
    })
  }

  reloadConfig() {
    this.proxyProvidersLoaded = false
    this.logger.info("[Workspace] Config reload requested")
    return this.bootstrap()
  }

  async createMainAgent(options: CreateMainAgentOptions) {
    if (this.mainAgent) {
      throw new Error("Workspace already has a main agent")
    }

    const { agent, baseSystemPrompt, kind, solverMeta } = this.createMainAgentInternal(options)
    this.mainAgent = agent
    this.attachAgentStateTracking(agent, baseSystemPrompt, kind, solverMeta)

    if (this.agentStateProxy) {
      await this.safePersist(async () => {
        await this.persistence.recordChange({
          type: "main-agent-created",
          agentState: this.agentStateProxy!.getPersistedState(),
        })
      })
    }

    this.logger.info("[Workspace] Main agent created")

    return this.mainAgent
  }

  private createMainAgentInternal(options: CreateMainAgentOptions): {
    agent: MainAgent
    baseSystemPrompt?: string
    kind: "solver" | "coordinator"
    solverMeta?: PersistedSolverAgentMeta
  } {
    if (options.kind === "solver") {
      const { kind, ...solverOptions } = options
      void kind
      const baseSystemPrompt = solverOptions.initialState?.systemPrompt
      const initialState = {
        ...solverOptions.initialState,
        systemPrompt: baseSystemPrompt,
      }
      const skills =
        solverOptions.skills ?? loadAgentSkills({ role: "solver", launchDir: this.rootDir })

      const agent = new SolverAgent(
        {
          cwd: this.rootDir,
          logger: this.logger.child({ component: "solver-agent" }),
          providers: this.providers,
          persistence: this.persistence,
        },
        {
          ...solverOptions,
          initialState,
          skills,
        },
      )

      const solverMeta: PersistedSolverAgentMeta = {
        spawnMode: solverOptions.spawnMode ?? "standalone",
      }

      return {
        agent,
        baseSystemPrompt,
        kind: "solver",
        solverMeta,
      }
    }

    const { kind, ...coordinatorOptions } = options
    void kind
    const baseSystemPrompt = coordinatorOptions.initialState?.systemPrompt
    const initialState = {
      ...coordinatorOptions.initialState,
      systemPrompt: baseSystemPrompt,
    }
    const skills =
      coordinatorOptions.skills ?? loadAgentSkills({ role: "coordinator", launchDir: this.rootDir })

    const agent = new CoordinatorAgent(
      {
        cwd: this.rootDir,
        logger: this.logger.child({ component: "coordinator-agent" }),
        providers: this.providers,
        persistence: this.persistence,
      },
      {
        ...coordinatorOptions,
        initialState,
        skills,
      },
    )

    return {
      agent,
      baseSystemPrompt,
      kind: "coordinator",
    }
  }

  private attachAgentStateTracking(
    agent: MainAgent,
    baseSystemPrompt: string | undefined,
    kind: "solver" | "coordinator",
    solverMeta?: PersistedSolverAgentMeta,
  ) {
    this.agentStateProxy = new AgentStateProxy(
      agent,
      this.persistence,
      this.logger,
      kind,
      baseSystemPrompt,
      solverMeta,
    )
    this.unsubscribeAgentTracking = this.agentStateProxy.enableTracking()
  }

  getModel(provider: string, modelId: string) {
    return this.providers.getModel(provider, modelId)
  }

  private async restoreFromPersistence() {
    try {
      this.bootstrap()
      const persistedState = await this.persistence.restoreState()
      if (!persistedState) {
        return
      }

      this.logger.info("[Workspace] Restoring workspace state from persistence")

      if (persistedState.proxyProvidersLoaded) {
        this.bootstrap()
      }

      if (persistedState.mainAgent) {
        if (
          persistedState.mainAgent.kind !== "solver" &&
          persistedState.mainAgent.kind !== "coordinator"
        ) {
          throw new Error("[Workspace] Corrupted workspace state: unknown main agent kind")
        }

        if (
          persistedState.mainAgent.kind === "solver" &&
          !persistedState.mainAgent.solverMeta?.spawnMode
        ) {
          throw new Error("[Workspace] Corrupted workspace state: missing solver spawn mode")
        }

        const model = this.validateAndResolvePersistedModel(persistedState.mainAgent)

        const restoredBaseOptions = {
          ...persistedState.mainAgent.mainAgentOptions,
          initialState: {
            ...persistedState.mainAgent.mainAgentOptions.initialState,
            systemPrompt:
              persistedState.mainAgent.baseSystemPrompt ??
              persistedState.mainAgent.mainAgentOptions.initialState?.systemPrompt,
            model,
          },
        }

        const restoredOptions: CreateMainAgentOptions =
          persistedState.mainAgent.kind === "solver"
            ? {
                kind: "solver",
                ...(restoredBaseOptions as SolverAgentOptions),
                spawnMode: persistedState.mainAgent.solverMeta.spawnMode,
              }
            : {
                kind: "coordinator",
                ...(restoredBaseOptions as CoordinatorAgentOptions),
              }

        const { agent, baseSystemPrompt, kind, solverMeta } =
          this.createMainAgentInternal(restoredOptions)
        this.mainAgent = agent
        this.attachAgentStateTracking(agent, baseSystemPrompt, kind, solverMeta)

        if (this.agentStateProxy) {
          await this.agentStateProxy.restoreFromPersistedState(persistedState.mainAgent)
        }

        this.logger.info("[Workspace] Main agent state restored", {
          messageCount: persistedState.mainAgent.agentState.messages?.length ?? 0,
        })
      }
    } catch (error) {
      this.logger.error("[Workspace] Failed to restore workspace state", error)
      throw error
    }
  }

  private validateAndResolvePersistedModel(persistedAgent: any) {
    if (!persistedAgent.modelId) {
      throw new Error(
        "[Workspace] Corrupted workspace state: missing modelId. Cannot restore agent.",
      )
    }

    const separatorIndex = persistedAgent.modelId.indexOf("/")
    if (separatorIndex <= 0 || separatorIndex === persistedAgent.modelId.length - 1) {
      throw new Error(
        `[Workspace] Corrupted workspace state: invalid modelId format "${persistedAgent.modelId}". Expected "provider/modelId".`,
      )
    }

    const provider = persistedAgent.modelId.slice(0, separatorIndex)
    const modelId = persistedAgent.modelId.slice(separatorIndex + 1)

    const model = this.providers.getModel(provider, modelId)
    if (!model) {
      throw new Error(
        `[Workspace] Corrupted workspace state: model not found in registry (provider: "${provider}", modelId: "${modelId}"). ` +
          "The model may have been removed from the provider registry or API.",
      )
    }

    this.logger.debug("[Workspace] Agent state validation passed", {
      modelId: persistedAgent.modelId,
      model: `${model.provider}/${model.id}`,
    })

    return model
  }

  async shutdown() {
    if (this.unsubscribeAgentTracking) {
      this.unsubscribeAgentTracking()
      this.unsubscribeAgentTracking = undefined
    }

    await this.persistence.flush()

    this.logger.info("[Workspace] Workspace shutdown completed")
  }
}

function createDefaultContainer(
  rootDir: string,
  configureContainer?: (container: Container) => void,
) {
  const container = createContainer()

  const logger = createWorkspaceLogger({
    level: getLogLevelFromEnv(),
    context: { workspaceRootDir: rootDir },
    sinks: [new ConsoleLogSink(process.env.MISUZU_LOG_FORMAT === "json" ? "json" : "pretty")],
  })

  container.registerSingleton(loggerToken, () => logger)
  container.registerSingleton(providerRegistryToken, () => new ProviderRegistry())
  container.registerSingleton(persistenceStoreToken, () => new JsonFilePersistenceAdapter(logger))

  configureContainer?.(container)
  return container
}

export function createWorkspaceWithoutPersistence(options: WorkspaceOptions = {}) {
  const rootDir = options.rootDir ?? process.cwd()
  const paths = resolveWorkspacePaths(rootDir)
  return new Workspace(
    paths.rootDir,
    createDefaultContainer(paths.rootDir, options.configureContainer),
  )
}

export async function createWorkspace(options: WorkspaceOptions = {}) {
  const workspace = createWorkspaceWithoutPersistence(options)
  await workspace.initPersistence()
  return workspace
}

export async function getWorkspace(rootDir = process.cwd()) {
  const paths = resolveWorkspacePaths(rootDir)
  const existing = workspaceRegistry.get(paths.rootDir)
  if (existing) {
    return existing
  }
  const workspace = await createWorkspace({ rootDir: paths.rootDir })
  workspaceRegistry.set(paths.rootDir, workspace)
  return workspace
}
