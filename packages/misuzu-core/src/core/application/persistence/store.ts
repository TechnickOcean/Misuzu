import type { AgentState, AgentMessage } from "@mariozechner/pi-agent-core"

export interface PersistedWorkspaceState {
  version: string
  lastModified: string
  proxyProvidersLoaded: boolean
  mainAgent?: PersistedFeaturedAgentState
}

export interface PersistedFeaturedAgentState {
  // Stored as "provider/modelId" and resolved from the registry at restore time.
  modelId: string

  // Base prompt passed to FeaturedAgent before skills catalog injection.
  baseSystemPrompt?: string

  agentState: AgentState

  featuredAgentOptions: {
    initialState?: Partial<AgentState>
    skills?: unknown[]
    tools?: unknown[]
    [key: string]: unknown
  }

  messagesFileRef?: {
    fileIndices: number[]
    messageCounts: number[]
  }

  lastOperationType?: "message_end" | "state_update" | "tool_execution"
  lastModified: string
}

export interface PersistenceStore {
  initialize(workspaceRootDir: string): Promise<void>
  hasPersistedState(): Promise<boolean>
  restoreState(): Promise<PersistedWorkspaceState | null>
  recordChange(change: WorkspaceChange): Promise<void>
  getCurrentState(): PersistedWorkspaceState | null
  flush(): Promise<void>
  clear(): Promise<void>
}

export type WorkspaceChange =
  | { type: "state-initialized"; state: PersistedWorkspaceState }
  | { type: "providers-loaded" }
  | { type: "main-agent-created"; agentState: PersistedFeaturedAgentState }
  | { type: "agent-message-added"; message: AgentMessage; newMessageCount: number }
  | { type: "agent-state-updated"; agentState: PersistedFeaturedAgentState }
  | { type: "tool-execution"; toolName: string; result: unknown }
