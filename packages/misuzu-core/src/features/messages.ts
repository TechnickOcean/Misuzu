import type { AgentMessage } from "@mariozechner/pi-agent-core"
import type { Message } from "@mariozechner/pi-ai"

// Custom message types for CTF operations
declare module "@mariozechner/pi-agent-core" {
  interface CustomAgentMessages {
    flagResult: FlagResultMessage
    challengeUpdate: ChallengeUpdateMessage
    compactionSummary: CompactionSummaryMessage
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

export type CustomAgentMessage =
  | FlagResultMessage
  | ChallengeUpdateMessage
  | CompactionSummaryMessage

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
      case "user":
      case "assistant":
      case "toolResult":
        return [m]
      default:
        return []
    }
  })
}
