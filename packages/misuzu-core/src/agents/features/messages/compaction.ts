import { type UserMessage } from "@mariozechner/pi-ai"

export interface CompactionMessageContent {
  role: "compaction"
  summary: string
  tokensBefore: number
  timestamp: number
}

export const compactionMessage = {
  transform: (m: CompactionMessageContent) =>
    ({
      role: "user",
      content: `<summary>Previous conversation summary (${m.tokensBefore} tokens):\n${m.summary}</summary>`,
      timestamp: m.timestamp,
    }) as UserMessage,
  calculateToken: (m: CompactionMessageContent) => m.summary.length,
  compactionContext: (m: CompactionMessageContent) => `[Previous summary]: ${m.summary}`,
}
