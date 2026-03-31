import type { AgentEvent } from "@mariozechner/pi-agent-core"
import type { PersistenceStore } from "./store.ts"

export class NoopPersistenceStore implements PersistenceStore {
  recordAgentEvent(_sessionId: string, _event: AgentEvent) {
    return
  }
}
