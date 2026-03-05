export type WorkspaceFile = {
  path: string
  name: string
  type: "file" | "dir"
  size?: number
  updated_at?: string
}

export type AgentState = {
  status?: "idle" | "running" | "paused" | "blocked" | "done" | "failed" | "max_steps" | "filtered"
  step_count?: number
  last_agent?: string
  updated_at?: string
}

export type WorkspaceStats = {
  findings_count: number
  knowledge_count: number
  files_count: number
}

export type WorkspaceRecord = {
  id: string
  title: string
  path?: string
  agent_state?: AgentState | null
  is_running?: boolean
  stats?: WorkspaceStats
}

export type WorkspaceEvent = {
  type: "workspaces"
  data: WorkspaceRecord[]
}

export type AgentEvent = {
  type: "agent_event"
  workspace_id: string
  data: { type: string; [key: string]: unknown }
}
