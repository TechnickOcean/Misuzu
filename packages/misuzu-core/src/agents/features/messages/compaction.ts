import { type UserMessage } from "@mariozechner/pi-ai"
import type { CustomMessage, CustomMessageHandler } from "./index.ts"

export interface CompactionMessage extends CustomMessage {
  role: "compaction"
  summary: string
  tokensBefore: number
  timestamp: number
}

export const compactionMessageHandler: CustomMessageHandler<CompactionMessage> = {
  transform: (m: CompactionMessage) =>
    ({
      role: "user",
      content: `<summary>Previous conversation summary (${m.tokensBefore} tokens):\n${m.summary}</summary>`,
      timestamp: m.timestamp,
    }) as UserMessage,
  calculateToken: (m: CompactionMessage) => m.summary.length,
  compactionContext: (m: CompactionMessage) => `[Previous summary]: ${m.summary}`,
}
