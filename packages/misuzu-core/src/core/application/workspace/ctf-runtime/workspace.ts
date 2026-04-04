import { readFileSync } from "node:fs"
import { join } from "node:path"
import { EnvironmentAgent, type EnvironmentAgentOptions } from "../../../../agents/environment.ts"
import { SolverAgent, type SolverAgentOptions } from "../../../../agents/solver.ts"
import { resolveWorkspacePaths } from "../shared/paths.ts"
import type { Container } from "../../../infrastructure/di/container.ts"
import { providerRegistryToken } from "../../../infrastructure/di/tokens.ts"
import { ProviderRegistry, type ProxyProviderOptions } from "../../providers/index.ts"
import {
  BaseWorkspace,
  type WorkspaceOptions,
  createWorkspaceContainer,
} from "../base/workspace.ts"
import { CTFRuntimePersistence } from "./persistence.ts"
import type { PersistedCTFRuntimeState } from "./state.ts"

const runtimeWorkspaceRegistry = new Map<string, CTFRuntimeWorkspace>()

export interface CTFRuntime {
  runtimeId: string
  getPersistedState: () => Record<string, unknown>
  restoreFromPersistedState?: (state: Record<string, unknown>) => Promise<void> | void
  shutdown?: () => Promise<void> | void
}

export interface CTFSolverTask {
  taskId: string
  payload: unknown
}

export interface CTFSolverTaskResult {
  taskId: string
  solverId: string
  output: unknown
}

export interface CTFSolver {
  solverId: string
  solve(task: CTFSolverTask): Promise<unknown>
}

interface PendingSolverTask {
  task: CTFSolverTask
  resolve: (result: CTFSolverTaskResult) => void
  reject: (error: unknown) => void
}

export class CTFRuntimeWorkspace extends BaseWorkspace {
  runtime?: CTFRuntime

  private readonly solverRegistry = new Map<string, CTFSolver>()
  private readonly pendingTaskQueue: PendingSolverTask[] = []
  private readonly idleSolverQueue: string[] = []
  private readonly busySolverIds = new Set<string>()

  private proxyProvidersLoaded = false
  private taskSequence = 0

  private readonly runtimePersistence: CTFRuntimePersistence
  private pendingRuntimeState?: PersistedCTFRuntimeState

  constructor(rootDir: string, container: Container) {
    super(rootDir, container)
    this.runtimePersistence = new CTFRuntimePersistence(this.logger)
  }

  override async initPersistence() {
    await this.runtimePersistence.initialize(this.rootDir)
    const state = this.runtimePersistence.getState()
    this.pendingRuntimeState = state?.runtimeState
  }

  get providers(): ProviderRegistry {
    return this.container.resolve(providerRegistryToken)
  }

  loadProxyProviderOptions() {
    try {
      return JSON.parse(readFileSync(this.providerConfigPath, "utf-8")) as ProxyProviderOptions[]
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.logger.debug(
          "[CTFRuntimeWorkspace] providers.json is missing, skip loading proxy providers",
          {
            providerConfigPath: this.providerConfigPath,
          },
        )
        return []
      }

      this.logger.error(
        "[CTFRuntimeWorkspace] Failed to load workspace provider config",
        { providerConfigPath: this.providerConfigPath },
        error,
      )
      throw error
    }
  }

  bootstrapProviders() {
    if (this.proxyProvidersLoaded) {
      this.logger.debug(
        "[CTFRuntimeWorkspace] provider bootstrap skipped because it is already loaded",
      )
      return []
    }

    const registeredModels = this.providers.registerProxyProviders(this.loadProxyProviderOptions())
    this.proxyProvidersLoaded = true
    this.logger.info("[CTFRuntimeWorkspace] Provider bootstrap completed", {
      registeredModelCount: registeredModels.length,
    })

    return registeredModels
  }

  reloadProviderConfig() {
    this.proxyProvidersLoaded = false
    this.logger.info("[CTFRuntimeWorkspace] Provider config reload requested")
    return this.bootstrapProviders()
  }

  getModel(provider: string, modelId: string) {
    return this.providers.getModel(provider, modelId)
  }

  createSolver(options: SolverAgentOptions = {}) {
    return new SolverAgent(
      {
        cwd: this.rootDir,
        logger: this.logger.child({ component: "solver-agent" }),
        providers: this.providers,
        persistence: this.persistence,
      },
      options,
    )
  }

  createEnvironmentAgent(options: EnvironmentAgentOptions = {}) {
    const workspaceBaseDir = options.workspaceBaseDir ?? join(this.rootDir, "plugins")

    return new EnvironmentAgent(
      {
        cwd: workspaceBaseDir,
        logger: this.logger.child({ component: "environment-agent" }),
        providers: this.providers,
        persistence: this.persistence,
      },
      {
        ...options,
        workspaceBaseDir,
      },
    )
  }

  registerSolver(solver: CTFSolver) {
    if (this.solverRegistry.has(solver.solverId)) {
      throw new Error(`Solver already registered: ${solver.solverId}`)
    }

    this.solverRegistry.set(solver.solverId, solver)
    this.idleSolverQueue.push(solver.solverId)
    this.scheduleSolverDispatch()
  }

  unregisterSolver(solverId: string) {
    this.solverRegistry.delete(solverId)
    this.removeIdleSolver(solverId)
  }

  enqueueTask(payload: unknown, taskId = this.nextTaskId()) {
    const task: CTFSolverTask = { taskId, payload }

    return new Promise<CTFSolverTaskResult>((resolve, reject) => {
      this.pendingTaskQueue.push({ task, resolve, reject })
      this.scheduleSolverDispatch()
    })
  }

  getSchedulerState() {
    return {
      pendingTaskCount: this.pendingTaskQueue.length,
      idleSolverCount: this.idleSolverQueue.length,
      busySolverCount: this.busySolverIds.size,
      registeredSolverCount: this.solverRegistry.size,
    }
  }

  async attachRuntime(runtime: CTFRuntime) {
    this.runtime = runtime

    if (
      this.pendingRuntimeState &&
      this.pendingRuntimeState.runtimeId === runtime.runtimeId &&
      runtime.restoreFromPersistedState
    ) {
      await runtime.restoreFromPersistedState(this.pendingRuntimeState.payload)
    }

    this.pendingRuntimeState = undefined
  }

  async persistRuntimeState() {
    if (!this.runtimePersistence.isInitialized) {
      throw new Error("CTFRuntimeWorkspace persistence is not initialized")
    }

    if (!this.runtime) {
      throw new Error("CTFRuntimeWorkspace has no attached runtime")
    }

    await this.runtimePersistence.saveRuntimeState({
      runtimeId: this.runtime.runtimeId,
      payload: this.runtime.getPersistedState(),
    })
  }

  async clearRuntimeState() {
    if (!this.runtimePersistence.isInitialized) {
      throw new Error("CTFRuntimeWorkspace persistence is not initialized")
    }

    await this.runtimePersistence.clear()
    this.pendingRuntimeState = undefined
  }

  override async shutdown() {
    if (this.runtime && this.runtimePersistence.isInitialized) {
      await this.persistRuntimeState()
    }

    await this.runtime?.shutdown?.()

    this.logger.info("[CTFRuntimeWorkspace] Workspace shutdown completed")
  }

  private nextTaskId() {
    this.taskSequence += 1
    return `task-${this.taskSequence}`
  }

  private scheduleSolverDispatch() {
    while (this.pendingTaskQueue.length > 0 && this.idleSolverQueue.length > 0) {
      const pendingTask = this.pendingTaskQueue.shift()
      const solverId = this.idleSolverQueue.shift()

      if (!pendingTask || !solverId) {
        return
      }

      const solver = this.solverRegistry.get(solverId)
      if (!solver) {
        continue
      }

      this.busySolverIds.add(solverId)

      void Promise.resolve(solver.solve(pendingTask.task))
        .then((output) => {
          pendingTask.resolve({
            taskId: pendingTask.task.taskId,
            solverId,
            output,
          })
        })
        .catch((error) => {
          pendingTask.reject(error)
        })
        .finally(() => {
          this.busySolverIds.delete(solverId)

          if (this.solverRegistry.has(solverId)) {
            this.idleSolverQueue.push(solverId)
          }

          this.scheduleSolverDispatch()
        })
    }
  }

  private removeIdleSolver(solverId: string) {
    const solverIndex = this.idleSolverQueue.indexOf(solverId)
    if (solverIndex >= 0) {
      this.idleSolverQueue.splice(solverIndex, 1)
    }
  }
}

export function createCTFRuntimeWorkspaceWithoutPersistence(options: WorkspaceOptions = {}) {
  const rootDir = options.rootDir ?? process.cwd()
  const paths = resolveWorkspacePaths(rootDir)
  return new CTFRuntimeWorkspace(
    paths.rootDir,
    createWorkspaceContainer(paths.rootDir, options.configureContainer),
  )
}

export async function createCTFRuntimeWorkspace(options: WorkspaceOptions = {}) {
  const workspace = createCTFRuntimeWorkspaceWithoutPersistence(options)
  await workspace.initPersistence()
  return workspace
}

export async function getCTFRuntimeWorkspace(rootDir = process.cwd()) {
  const paths = resolveWorkspacePaths(rootDir)
  const existing = runtimeWorkspaceRegistry.get(paths.rootDir)
  if (existing) {
    return existing
  }

  const workspace = await createCTFRuntimeWorkspace({ rootDir: paths.rootDir })
  runtimeWorkspaceRegistry.set(paths.rootDir, workspace)
  return workspace
}
