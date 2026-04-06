import { createToken } from "../../../../infrastructure/di/container.ts"
import { RuntimeOrchestrator } from "./platform/runtime.ts"
import { WorkspaceModelPool } from "./model/pool.ts"
import { SolverHub } from "./platform/hub.ts"
import { SolverWorkspaceService } from "./solver/workspaces.ts"
import { SyncService } from "./platform/sync.ts"
import { QueueService } from "./scheduler/queue.ts"

export const queueToken = createToken<QueueService>("queue")
export const modelPoolToken = createToken<WorkspaceModelPool>("modelPool")
export const solverWorkspaceServiceToken =
  createToken<SolverWorkspaceService>("solverWorkspaceService")
export const solverHubToken = createToken<SolverHub>("solverHub")
export const syncToken = createToken<SyncService>("sync")
export const orchestratorToken = createToken<RuntimeOrchestrator>("orchestrator")
