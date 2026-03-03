export type AgentState = {
  status?: string
  step_count?: number
  last_agent?: string
  updated_at?: string
}

export type WorkspaceRecord = {
  id: number
  title: string
  path?: string
  store?: {
    status?: string
    findings?: unknown[]
    knowledge_index?: { title: string; source: string; summary: string }[]
    progress?: unknown[]
  } | null
  agent_state?: AgentState | null
  is_running?: boolean
}

export type WorkspaceEvent = {
  type: "workspaces"
  data: WorkspaceRecord[]
}

export type AgentEvent = {
  type: "agent_event"
  workspace_id: number
  data: { type: string; [key: string]: unknown }
}
