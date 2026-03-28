import type {
  RuntimeCommandRequest,
  RuntimeCommandResponse,
  RuntimeEventEnvelope,
  RuntimeSnapshot,
  WorkspaceSummary,
} from "./protocol.ts"

export interface RuntimeHost {
  getSnapshot(): RuntimeSnapshot
  getEventsSince(seq?: number): RuntimeEventEnvelope[]
  subscribeEvents(listener: (event: RuntimeEventEnvelope) => void): () => void
  executeCommand(request: RuntimeCommandRequest): Promise<RuntimeCommandResponse>
  listWorkspaces(): WorkspaceSummary[]
}
