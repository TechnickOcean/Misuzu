import type { AgentMessage } from "@mariozechner/pi-agent-core"
import type { Message } from "@mariozechner/pi-ai"

// Custom message types for CTF operations
declare module "@mariozechner/pi-agent-core" {
  interface CustomAgentMessages {
    flagResult: FlagResultMessage
    challengeUpdate: ChallengeUpdateMessage
    compactionSummary: CompactionSummaryMessage
    schedulerUpdate: SchedulerUpdateMessage
  }
}

export interface FlagResultMessage {
  role: "flagResult"
  challengeId: string
  flag: string
  correct: boolean
  message: string
  timestamp: number
}

export interface ChallengeUpdateMessage {
  role: "challengeUpdate"
  challengeId: string
  status: "assigned" | "solving" | "solved" | "failed"
  details: string
  timestamp: number
}

export interface CompactionSummaryMessage {
  role: "compactionSummary"
  summary: string
  tokensBefore: number
  timestamp: number
}

export interface SchedulerUpdateMessage {
  role: "schedulerUpdate"
  challengeId: string
  challengeName: string
  status: "started" | "requeued" | "skipped" | "failed"
  reason: string
  queueBefore: number
  queueAfter: number
  model?: string
  timestamp: number
}

export type CustomAgentMessage =
  | FlagResultMessage
  | ChallengeUpdateMessage
  | CompactionSummaryMessage
  | SchedulerUpdateMessage

/** Convert custom messages to LLM-compatible user messages. */
export function convertToLlm(messages: AgentMessage[]): Message[] {
  return messages.flatMap((m): Message[] => {
    switch (m.role) {
      case "flagResult":
        return [
          {
            role: "user" as const,
            content: `[Flag ${m.correct ? "CORRECT" : "WRONG"}] ${m.flag}: ${m.message}`,
            timestamp: m.timestamp,
          },
        ]
      case "challengeUpdate":
        return [
          {
            role: "user" as const,
            content: `[Challenge ${m.challengeId}: ${m.status}] ${m.details}`,
            timestamp: m.timestamp,
          },
        ]
      case "compactionSummary":
        return [
          {
            role: "user" as const,
            content: `<summary>Previous conversation summary (${m.tokensBefore} tokens):\n${m.summary}</summary>`,
            timestamp: m.timestamp,
          },
        ]
      case "schedulerUpdate": {
        const modelSuffix = m.model ? `; model=${m.model}` : ""
        return [
          {
            role: "user" as const,
            content:
              `[Scheduler ${m.status.toUpperCase()}] ${m.challengeId} (${m.challengeName}) ` +
              `reason=${m.reason}; queue ${m.queueBefore}->${m.queueAfter}${modelSuffix}`,
            timestamp: m.timestamp,
          },
        ]
      }
      case "user":
      case "assistant":
      case "toolResult":
        return [m]
      default:
        return []
    }
  })
}
