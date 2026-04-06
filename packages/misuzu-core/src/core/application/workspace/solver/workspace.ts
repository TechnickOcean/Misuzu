import { AgentStateProxy } from "../../../../agents/features/agent-state-proxy.ts"
import { loadAgentSkills } from "../../../../agents/features/skill.ts"
import { SolverAgent, type SolverAgentOptions } from "../../../../agents/solver.ts"
import type { Container } from "../../../infrastructure/di/container.ts"
import { providerRegistryToken } from "../../../infrastructure/di/tokens.ts"
import { ProviderRegistry } from "../../providers/registry.ts"
import { resolveWorkspacePaths } from "../shared/paths.ts"
import { ProxyProviderBootstrap } from "../shared/proxy-provider-bootstrap.ts"
import {
  BaseWorkspace,
  type WorkspaceOptions,
  createWorkspaceContainer,
} from "../base/workspace.ts"

const workspaceRegistry = new Map<string, SolverWorkspace>()

export interface SolverWorkspaceOptions extends WorkspaceOptions {
  configRootDir?: string
  providerBootstrap?: ProxyProviderBootstrap
}

export class SolverWorkspace extends BaseWorkspace {
  mainAgent?: SolverAgent
  private agentStateProxy?: AgentStateProxy
  private unsubscribeAgentTracking?: () => void
  readonly configRootDir: string

  private readonly providerBootstrap: ProxyProviderBootstrap

  constructor(rootDir: string, container: Container, options: SolverWorkspaceOptions = {}) {
    super(rootDir, container)

    const configPaths = resolveWorkspacePaths(options.configRootDir ?? rootDir)
    this.configRootDir = configPaths.rootDir

    this.providerBootstrap =
      options.providerBootstrap ??
      new ProxyProviderBootstrap({
        logger: this.logger.child({ component: "ProxyProviderBootstrap" }),
        providers: this.providers,
        providerConfigPath: configPaths.providerConfigPath,
        onProvidersLoaded: () => {
          const persistence = this.persistence
          if (persistence) {
            void this.safePersist(() => persistence.recordChange({ type: "providers-loaded" }))
          }
        },
      })
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

    this.logger.info("Main agent created")

    return this.mainAgent
  }

  get providers(): ProviderRegistry {
    return this.container.resolve(providerRegistryToken)
  }

  loadProxyProviderOptions() {
    return this.providerBootstrap.loadProxyProviderOptions()
  }

  bootstrap() {
    return this.providerBootstrap.bootstrap()
  }

  reloadConfig() {
    return this.providerBootstrap.reload()
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

      this.logger.info("Restoring workspace state from persistence")

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

        this.logger.info("Main agent state restored", {
          messageCount: persistedState.mainAgent.agentState.messages?.length ?? 0,
        })
      }
    } catch (error) {
      this.logger.error("Failed to restore workspace state", error)
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
    const skills = options.skills ?? loadAgentSkills({ launchDir: this.configRootDir })

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
      this.logger.child({ component: "AgentStateProxy" }),
      baseSystemPrompt,
    )
    this.unsubscribeAgentTracking = this.agentStateProxy.enableTracking()
  }

  private validateAndResolvePersistedModel(persistedAgent: { modelId?: string }) {
    if (!persistedAgent.modelId) {
      throw new Error("Corrupted workspace state: missing modelId. Cannot restore agent.")
    }

    const separatorIndex = persistedAgent.modelId.indexOf("/")
    if (separatorIndex <= 0 || separatorIndex === persistedAgent.modelId.length - 1) {
      throw new Error(
        `Corrupted workspace state: invalid modelId format "${persistedAgent.modelId}". Expected "provider/modelId".`,
      )
    }

    const provider = persistedAgent.modelId.slice(0, separatorIndex)
    const modelId = persistedAgent.modelId.slice(separatorIndex + 1)

    const model = this.providers.getModel(provider, modelId)
    if (!model) {
      throw new Error(
        `Corrupted workspace state: model not found in registry (provider: "${provider}", modelId: "${modelId}"). ` +
          "The model may have been removed from the provider registry or API.",
      )
    }

    this.logger.debug("Agent state validation passed", {
      modelId: persistedAgent.modelId,
      model: `${model.provider}/${model.id}`,
    })

    return model
  }
}

export function createSolverWorkspaceWithoutPersistence(options: SolverWorkspaceOptions = {}) {
  const rootDir = options.rootDir ?? process.cwd()
  const paths = resolveWorkspacePaths(rootDir)
  return new SolverWorkspace(
    paths.rootDir,
    createWorkspaceContainer(paths.rootDir, options.configureContainer),
    options,
  )
}

export async function createSolverWorkspace(options: SolverWorkspaceOptions = {}) {
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
