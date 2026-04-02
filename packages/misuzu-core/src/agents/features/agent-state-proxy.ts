import type { AgentEvent, AgentState, AgentMessage } from "@mariozechner/pi-agent-core"
import type { FeaturedAgent } from "../featured.ts"
import type {
  PersistedMainAgentKind,
  PersistedMainAgentState,
  PersistenceStore,
  PersistedSolverAgentMeta,
} from "../../core/application/persistence/store.ts"
import type { Logger } from "../../core/infrastructure/logging/types.ts"

export class AgentStateProxy {
  constructor(
    private featuredAgent: FeaturedAgent,
    private persistence: PersistenceStore,
    private logger: Logger,
    private mainAgentKind: PersistedMainAgentKind,
    private baseSystemPrompt?: string,
    private solverMeta?: PersistedSolverAgentMeta,
  ) {}

  setBaseSystemPrompt(systemPrompt?: string) {
    this.baseSystemPrompt = systemPrompt
  }

  enableTracking() {
    const unsubscribe = this.featuredAgent.subscribe((event: AgentEvent) => {
      try {
        this.handleAgentEvent(event)
      } catch (error) {
        this.logger.error(
          "[AgentStateProxy] Failed to handle agent event",
          { eventType: event.type },
          error,
        )
      }
    })
    return unsubscribe
  }

  async restoreFromPersistedState(persistedState: PersistedMainAgentState) {
    const { agentState } = persistedState

    if (agentState.messages && agentState.messages.length > 0) {
      this.featuredAgent.replaceMessages(agentState.messages)
    }

    this.logger.info("[AgentStateProxy] Restored agent state from persistence", {
      messageCount: agentState.messages?.length ?? 0,
    })
  }

  getPersistedState(): PersistedMainAgentState {
    const agentState = this.featuredAgent.state
    const modelId = this.getCurrentModelId(agentState)

    const cleanedAgentState = this.sanitizeAgentState(agentState)

    const baseState = {
      modelId,
      baseSystemPrompt: this.baseSystemPrompt,
      agentState: cleanedAgentState,
      mainAgentOptions: {
        initialState: {
          systemPrompt: this.baseSystemPrompt,
          thinkingLevel: agentState.thinkingLevel,
        },
      },
      lastModified: new Date().toISOString(),
    }

    if (this.mainAgentKind === "solver") {
      if (!this.solverMeta) {
        throw new Error("Cannot persist solver state: missing solver metadata")
      }

      return {
        ...baseState,
        kind: "solver",
        solverMeta: this.solverMeta,
      }
    }

    return {
      ...baseState,
      kind: "coordinator",
      coordinatorMeta: {},
    }
  }

  private getCurrentModelId(agentState: AgentState): string {
    const model = agentState.model
    if (!model) {
      throw new Error("Cannot persist agent state: model is not set")
    }

    return `${model.provider}/${model.id}`
  }

  private sanitizeAgentState(agentState: AgentState): AgentState {
    const cleanedAgentState: AgentState = {
      ...agentState,
      messages: this.filterMessages(agentState.messages ?? []),
    }

    const stateAsRecord = cleanedAgentState as unknown as Record<string, unknown>
    delete stateAsRecord.model
    delete stateAsRecord.tools
    delete stateAsRecord.systemPrompt
    delete stateAsRecord.isStreaming
    delete stateAsRecord.streamMessage
    delete stateAsRecord.pendingToolCalls
    delete stateAsRecord.error
    delete stateAsRecord.usage

    return cleanedAgentState
  }

  private filterMessages(messages: AgentMessage[]): AgentMessage[] {
    return messages.filter((msg) => {
      if (msg.role === "assistant") {
        if (msg.stopReason === "error") {
          return false
        }
        if (!msg.content || msg.content.length === 0) {
          return false
        }
      }
      return true
    })
  }

  private handleAgentEvent(event: AgentEvent): void {
    switch (event.type) {
      case "message_end":
      case "agent_end":
        this.persistCurrentState()
        break
      default:
        break
    }
  }

  private persistCurrentState() {
    void this.persistence
      .recordChange({
        type: "agent-state-updated",
        agentState: this.getPersistedState(),
      })
      .catch((error) => {
        if ((error as Error).message !== "PersistenceStore not initialized") {
          this.logger.warn("[AgentStateProxy] Failed to record state update", error)
        }
      })
  }
}
