import { createToken } from "../../../../infrastructure/di/container.ts"
import { RuntimeOrchestrator } from "./orchestrator.ts"
import { SolverHub } from "./solver-hub.ts"
import { SyncService } from "./sync.ts"
import { QueueService } from "./queue.ts"

export const queueToken = createToken<QueueService>("queue")
export const solverHubToken = createToken<SolverHub>("solverHub")
export const syncToken = createToken<SyncService>("sync")
export const orchestratorToken = createToken<RuntimeOrchestrator>("orchestrator")
