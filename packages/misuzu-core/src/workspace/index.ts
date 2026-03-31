import { readFileSync } from "node:fs"
import { loadAgentSkills } from "../features/skill.ts"
import { FeaturedAgent, type FeaturedAgentOptions } from "../agents/featured.ts"
import { createBaseTools } from "../tools/index.ts"
import { createContainer, type Container } from "../di/container.ts"
import {
  loggerToken,
  persistenceStoreToken,
  providerRegistryToken,
  sessionContextToken,
} from "../di/tokens.ts"
import { createWorkspaceLogger, getLogLevelFromEnv } from "../logging/logger.ts"
import { ConsoleLogSink } from "../logging/sinks/console-sink.ts"
import type { Logger } from "../logging/types.ts"
import { NoopPersistenceStore } from "../persistence/noop-store.ts"
import type { PersistenceStore } from "../persistence/store.ts"
import { ProviderRegistry, type ProxyProviderOptions } from "../providers/index.ts"
import { SessionContext } from "../session/context.ts"
import { resolveWorkspacePaths } from "./paths.ts"

const workspaceRegistry = new Map<string, Workspace>()

export interface WorkspaceOptions {
  rootDir?: string
  configureContainer?: (container: Container) => void
}

export class Workspace {
  readonly rootDir: string
  readonly markerDir: string
  readonly skillsRootDir: string
  readonly providerConfigPath: string

  private readonly container: Container
  private proxyProvidersLoaded = false
  private mainAgent?: FeaturedAgent

  constructor(rootDir: string, container: Container) {
    const paths = resolveWorkspacePaths(rootDir)
    this.rootDir = paths.rootDir
    this.markerDir = paths.markerDir
    this.skillsRootDir = paths.skillsRootDir
    this.providerConfigPath = paths.providerConfigPath
    this.container = container
  }

  get providers(): ProviderRegistry {
    return this.container.resolve(providerRegistryToken)
  }

  get session(): SessionContext {
    return this.container.resolve(sessionContextToken)
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

  bootstrap() {
    if (this.proxyProvidersLoaded) {
      this.logger.debug("Workspace bootstrap skipped because it is already loaded")
      return []
    }

    const registeredModels = this.providers.registerProxyProviders(this.loadProxyProviderOptions())
    this.proxyProvidersLoaded = true
    this.logger.info("Workspace bootstrap completed", {
      registeredModelCount: registeredModels.length,
    })
    return registeredModels
  }

  reloadConfig() {
    this.proxyProvidersLoaded = false
    this.logger.info("Workspace config reload requested")
    return this.bootstrap()
  }

  createMainAgent(options: FeaturedAgentOptions = {}) {
    if (this.mainAgent) {
      throw new Error("Workspace already has a main agent")
    }

    this.bootstrap()

    const skills = options.skills ?? loadAgentSkills({ role: "shared", launchDir: this.rootDir })
    const tools = options.tools ?? createBaseTools(this.rootDir)

    this.mainAgent = new FeaturedAgent(
      {
        cwd: this.rootDir,
        logger: this.logger.child({ component: "featured-agent" }),
        providers: this.providers,
        persistence: this.persistence,
        session: this.session,
      },
      {
        ...options,
        skills,
        tools,
      },
    )

    this.logger.info("Workspace main agent created", { sessionId: this.session.sessionId })

    return this.mainAgent
  }

  getMainAgent() {
    return this.mainAgent
  }

  getModel(provider: string, modelId: string) {
    return this.providers.getModel(provider, modelId)
  }
}

function createDefaultContainer(
  rootDir: string,
  configureContainer?: (container: Container) => void,
) {
  const container = createContainer()

  container.registerSingleton(loggerToken, () =>
    createWorkspaceLogger({
      level: getLogLevelFromEnv(),
      context: { workspaceRootDir: rootDir },
      sinks: [new ConsoleLogSink(process.env.MISUZU_LOG_FORMAT === "json" ? "json" : "pretty")],
    }),
  )
  container.registerSingleton(providerRegistryToken, () => new ProviderRegistry())
  container.registerSingleton(sessionContextToken, () => new SessionContext())
  container.registerSingleton(persistenceStoreToken, () => new NoopPersistenceStore())

  configureContainer?.(container)
  return container
}

export function createWorkspace(options: WorkspaceOptions = {}) {
  const rootDir = options.rootDir ?? process.cwd()
  const paths = resolveWorkspacePaths(rootDir)
  return new Workspace(
    paths.rootDir,
    createDefaultContainer(paths.rootDir, options.configureContainer),
  )
}

export function getWorkspace(rootDir = process.cwd()) {
  const paths = resolveWorkspacePaths(rootDir)
  const existing = workspaceRegistry.get(paths.rootDir)
  if (existing) {
    return existing
  }

  const workspace = createWorkspace({ rootDir: paths.rootDir })
  workspaceRegistry.set(paths.rootDir, workspace)
  return workspace
}
