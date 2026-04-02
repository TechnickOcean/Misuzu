import { readFileSync } from "node:fs"
import { AgentStateProxy } from "../../../../agents/features/agent-state-proxy.ts"
import { loadAgentSkills } from "../../../../agents/features/skill.ts"
import { SolverAgent, type SolverAgentOptions } from "../../../../agents/solver.ts"
import type { Container } from "../../../infrastructure/di/container.ts"
import { providerRegistryToken } from "../../../infrastructure/di/tokens.ts"
import { ProviderRegistry, type ProxyProviderOptions } from "../../providers/index.ts"
import { resolveWorkspacePaths } from "../shared/paths.ts"
import {
  BaseWorkspace,
  type WorkspaceOptions,
  createWorkspaceContainer,
} from "../base/workspace.ts"

const workspaceRegistry = new Map<string, SolverWorkspace>()

export class SolverWorkspace extends BaseWorkspace {
  mainAgent?: SolverAgent
  private proxyProvidersLoaded = false
  private agentStateProxy?: AgentStateProxy
  private unsubscribeAgentTracking?: () => void

  constructor(rootDir: string, container: Container) {
    super(rootDir, container)
  }

  async createMainAgent(options: SolverAgentOptions = {}) {
    if (this.mainAgent) {
      throw new Error("Workspace already has a main agent")
    }

    const { agent, baseSystemPrompt } = this.createMainAgentInternal(options)
    this.mainAgent = agent
    this.attachAgentStateTracking(agent, baseSystemPrompt)

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

  get providers(): ProviderRegistry {
    return this.container.resolve(providerRegistryToken)
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

  reloadConfig() {
    this.proxyProvidersLoaded = false
    this.logger.info("[Workspace] Config reload requested")
    return this.bootstrap()
  }

  getModel(provider: string, modelId: string) {
    return this.providers.getModel(provider, modelId)
  }

  protected override async restoreFromPersistence() {
    try {
      this.bootstrap()
      const persistedState = await this.persistence.restoreState()
      if (!persistedState) {
        return
      }

      this.logger.info("[Workspace] Restoring workspace state from persistence")

      if (persistedState.mainAgent) {
        const model = this.validateAndResolvePersistedModel(persistedState.mainAgent)
        const restoredBaseOptions = persistedState.mainAgent
          .solverAgentOptions as SolverAgentOptions

        const restoredOptions: SolverAgentOptions = {
          ...restoredBaseOptions,
          initialState: {
            ...restoredBaseOptions.initialState,
            systemPrompt:
              persistedState.mainAgent.baseSystemPrompt ??
              restoredBaseOptions.initialState?.systemPrompt,
            model,
          },
        }

        const { agent, baseSystemPrompt } = this.createMainAgentInternal(restoredOptions)
        this.mainAgent = agent
        this.attachAgentStateTracking(agent, baseSystemPrompt)

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

  override async shutdown() {
    if (this.unsubscribeAgentTracking) {
      this.unsubscribeAgentTracking()
      this.unsubscribeAgentTracking = undefined
    }

    await super.shutdown()
  }

  private createMainAgentInternal(options: SolverAgentOptions): {
    agent: SolverAgent
    baseSystemPrompt?: string
  } {
    const baseSystemPrompt = options.initialState?.systemPrompt
    const initialState = {
      ...options.initialState,
      systemPrompt: baseSystemPrompt,
    }
    const skills = options.skills ?? loadAgentSkills({ launchDir: this.rootDir })

    const agent = new SolverAgent(
      {
        cwd: this.rootDir,
        logger: this.logger.child({ component: "solver-agent" }),
        providers: this.providers,
        persistence: this.persistence,
      },
      {
        ...options,
        initialState,
        skills,
      },
    )

    return {
      agent,
      baseSystemPrompt,
    }
  }

  private attachAgentStateTracking(agent: SolverAgent, baseSystemPrompt: string | undefined) {
    this.agentStateProxy = new AgentStateProxy(
      agent,
      this.persistence,
      this.logger,
      baseSystemPrompt,
    )
    this.unsubscribeAgentTracking = this.agentStateProxy.enableTracking()
  }

  private validateAndResolvePersistedModel(persistedAgent: { modelId?: string }) {
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
}

export function createSolverWorkspaceWithoutPersistence(options: WorkspaceOptions = {}) {
  const rootDir = options.rootDir ?? process.cwd()
  const paths = resolveWorkspacePaths(rootDir)
  return new SolverWorkspace(
    paths.rootDir,
    createWorkspaceContainer(paths.rootDir, options.configureContainer),
  )
}

export async function createSolverWorkspace(options: WorkspaceOptions = {}) {
  const workspace = createSolverWorkspaceWithoutPersistence(options)
  await workspace.initPersistence()
  return workspace
}

export async function getSolverWorkspace(rootDir = process.cwd()) {
  const paths = resolveWorkspacePaths(rootDir)
  const existing = workspaceRegistry.get(paths.rootDir)
  if (existing) {
    return existing
  }
  const workspace = await createSolverWorkspace({ rootDir: paths.rootDir })
  workspaceRegistry.set(paths.rootDir, workspace)
  return workspace
}
