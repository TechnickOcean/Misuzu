import type { Container } from "../../../infrastructure/di/container.ts"
import { loggerToken, providerRegistryToken } from "../../../infrastructure/di/tokens.ts"
import {
  QueueService,
  RuntimeOrchestrator,
  SolverHub,
  SolverWorkspaceService,
  SyncService,
  WorkspaceModelPool,
  modelPoolToken,
  orchestratorToken,
  queueToken,
  solverHubToken,
  solverWorkspaceServiceToken,
  syncToken,
} from "./services/index.ts"

export function registerCTFRuntimeServices(container: Container, rootDir: string) {
  // Shared queue for all managed solver tasks in this runtime workspace.
  container.registerSingleton(queueToken, () => new QueueService())

  container.registerSingleton(modelPoolToken, (currentContainer) => {
    const logger = currentContainer.resolve(loggerToken).child({ component: "WorkspaceModelPool" })
    return new WorkspaceModelPool({
      rootDir,
      logger,
      providers: currentContainer.resolve(providerRegistryToken),
    })
  })

  container.registerSingleton(solverWorkspaceServiceToken, (currentContainer) => {
    const logger = currentContainer
      .resolve(loggerToken)
      .child({ component: "SolverWorkspaceService" })

    return new SolverWorkspaceService({
      rootDir,
      logger,
      providers: currentContainer.resolve(providerRegistryToken),
    })
  })

  container.registerSingleton(solverHubToken, (currentContainer) => {
    const logger = currentContainer.resolve(loggerToken).child({ component: "SolverHub" })

    return new SolverHub({
      logger,
      queue: currentContainer.resolve(queueToken),
      solverWorkspaces: currentContainer.resolve(solverWorkspaceServiceToken),
      modelPool: currentContainer.resolve(modelPoolToken),
    })
  })

  container.registerSingleton(syncToken, (currentContainer) => {
    const logger = currentContainer.resolve(loggerToken).child({ component: "SyncService" })

    return new SyncService({
      logger,
      solverHub: currentContainer.resolve(solverHubToken),
    })
  })

  container.registerSingleton(orchestratorToken, (currentContainer) => {
    const logger = currentContainer.resolve(loggerToken).child({ component: "RuntimeOrchestrator" })

    return new RuntimeOrchestrator({
      logger,
      solverHub: currentContainer.resolve(solverHubToken),
      syncService: currentContainer.resolve(syncToken),
    })
  })
}
