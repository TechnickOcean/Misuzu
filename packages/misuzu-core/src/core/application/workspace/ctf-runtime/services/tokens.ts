import { createToken } from "../../../../infrastructure/di/container.ts"
import { RuntimeOrchestrator } from "./orchestrator.ts"
import { SolverHub } from "./solver-hub.ts"
import { SolverWorkspaceService } from "./solver-workspaces.ts"
import { SyncService } from "./sync.ts"
import { QueueService } from "./queue.ts"

export const queueToken = createToken<QueueService>("queue")
export const solverWorkspaceServiceToken =
  createToken<SolverWorkspaceService>("solverWorkspaceService")
export const solverHubToken = createToken<SolverHub>("solverHub")
export const syncToken = createToken<SyncService>("sync")
export const orchestratorToken = createToken<RuntimeOrchestrator>("orchestrator")
