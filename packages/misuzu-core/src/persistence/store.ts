import type { AgentEvent } from "@mariozechner/pi-agent-core"

export interface PersistenceStore {
  recordAgentEvent(sessionId: string, event: AgentEvent): Promise<void> | void
}
