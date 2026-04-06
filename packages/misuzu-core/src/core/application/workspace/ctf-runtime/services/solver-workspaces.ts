import { join } from "node:path"
import { SolverAgent, type SolverAgentOptions } from "../../../../../agents/solver.ts"
import { createSolverWorkspaceWithoutPersistence, SolverWorkspace } from "../../solver/workspace.ts"
import type { Logger } from "../../../../infrastructure/logging/types.ts"
import type { ProviderRegistry } from "../../../providers/registry.ts"
import { providerRegistryToken } from "../../../../infrastructure/di/tokens.ts"
import { resolveWorkspacePaths } from "../../shared/paths.ts"
import { ProxyProviderBootstrap } from "../../shared/proxy-provider-bootstrap.ts"

export interface SolverWorkspaceServiceDeps {
  rootDir: string
  logger: Logger
  providers: ProviderRegistry
}

export interface ManagedSolver {
  rootDir: string
  solver: SolverAgent
}

export class SolverWorkspaceService {
  private readonly rootDir: string
  private readonly logger: Logger
  private readonly providers: ProviderRegistry
  private readonly sharedProviderBootstrap: ProxyProviderBootstrap
  private readonly solverWorkspaces = new Map<string, SolverWorkspace>()

  constructor(deps: SolverWorkspaceServiceDeps) {
    this.rootDir = deps.rootDir
    this.logger = deps.logger
    this.providers = deps.providers

    const configPaths = resolveWorkspacePaths(this.rootDir)
    this.sharedProviderBootstrap = new ProxyProviderBootstrap({
      logger: this.logger.child({ component: "ProxyProviderBootstrap" }),
      providers: this.providers,
      providerConfigPath: configPaths.providerConfigPath,
    })
  }

  async getOrCreateSolver(solverId: string, options: SolverAgentOptions): Promise<ManagedSolver> {
    const workspace = await this.getOrCreateWorkspace(solverId)
    const solver = workspace.mainAgent ?? (await workspace.createMainAgent(options))
    return {
      rootDir: workspace.rootDir,
      solver,
    }
  }

  async getOrCreateWorkspace(solverId: string) {
    const existing = this.solverWorkspaces.get(solverId)
    if (existing) {
      return existing
    }

    const solverRootDir = join(this.rootDir, "solvers", solverId)
    const workspace = createSolverWorkspaceWithoutPersistence({
      rootDir: solverRootDir,
      configRootDir: this.rootDir,
      providerBootstrap: this.sharedProviderBootstrap,
      configureContainer: (container) => {
        // Reuse runtime provider registry to avoid per-solver model registry copies.
        container.registerValue(providerRegistryToken, this.providers)
      },
    })
    await workspace.initPersistence()
    workspace.bootstrap()

    this.solverWorkspaces.set(solverId, workspace)
    this.logger.info("Derived solver workspace created", {
      solverId,
      solverRootDir,
      configRootDir: this.rootDir,
    })

    return workspace
  }

  async shutdown() {
    const workspaces = [...this.solverWorkspaces.values()]
    this.solverWorkspaces.clear()

    await Promise.all(workspaces.map((workspace) => workspace.shutdown()))
  }
}
