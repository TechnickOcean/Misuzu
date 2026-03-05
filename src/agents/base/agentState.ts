import * as fs from "node:fs/promises"
import * as path from "node:path"
import type { ChatCompletionMessageParam } from "openai/resources"

export type AgentStateStatus = "idle" | "running" | "paused" | "blocked" | "done" | "failed" | "max_steps" | "filtered"

export interface AgentState {
  context: ChatCompletionMessageParam[]
  step_count: number
  status: AgentStateStatus
  last_agent: string
  updated_at: string
}

export function getAgentStatePath(workspacePath: string) {
  return path.join(workspacePath, ".misuzu", "agent_state.json")
}

export async function readAgentState(workspacePath: string): Promise<AgentState | null> {
  const statePath = getAgentStatePath(workspacePath)
  try {
    const raw = await fs.readFile(statePath, "utf-8")
    return JSON.parse(raw) as AgentState
  } catch {
    return null
  }
}

export async function writeAgentState(workspacePath: string, state: AgentState) {
  const dirPath = path.join(workspacePath, ".misuzu")
  await fs.mkdir(dirPath, { recursive: true })
  const statePath = getAgentStatePath(workspacePath)
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf-8")
}
