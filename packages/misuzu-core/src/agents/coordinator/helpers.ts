import { dirname, resolve } from "node:path"
import type { AgentMessage } from "@mariozechner/pi-agent-core"
import type { AssistantMessage, Model } from "@mariozechner/pi-ai"
import type { ChallengeUpdateMessage, FlagResultMessage } from "../../features/messages.ts"

export function getModelId(model: Model<any>): string {
  const candidate = (model as { id?: unknown }).id
  if (typeof candidate === "string" && candidate.trim().length > 0) {
    return candidate
  }
  return "model"
}

export function formatError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

export function isFlagResultMessage(message: AgentMessage): message is FlagResultMessage {
  return message.role === "flagResult"
}

export function isChallengeUpdateMessage(message: AgentMessage): message is ChallengeUpdateMessage {
  return message.role === "challengeUpdate"
}

export function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
  return message.role === "assistant"
}

export function inferLaunchRootFromWorkspaceDir(workspaceDir: string): string {
  const resolvedWorkspaceDir = resolve(workspaceDir)
  const workspacesDir = dirname(resolvedWorkspaceDir)
  const dotMisuzuDir = dirname(workspacesDir)
  return dirname(dotMisuzuDir)
}
