import type { AgentMessage } from "@mariozechner/pi-agent-core"
import type { Message } from "@mariozechner/pi-ai"
import { compactionMessageHandler, type CompactionMessage } from "./compaction.ts"

declare module "@mariozechner/pi-agent-core" {
  interface CustomAgentMessages {
    compaction: CompactionMessage
  }
}

export interface CustomMessage {
  role: string
  timestamp: number
}

export interface CustomMessageHandler<T extends CustomMessage> {
  transform: (m: T) => Message
  calculateToken: (m: T) => number
  compactionContext: (m: T) => string
}

/** Convert custom messages to LLM-compatible user messages. */
export function convertToLlm(messages: AgentMessage[]) {
  return messages.flatMap((m): Message[] => {
    switch (m.role) {
      case "compaction":
        return [compactionMessageHandler.transform(m)]
      case "user":
      case "assistant":
      case "toolResult":
        return [m]
      default:
        return []
    }
  })
}
