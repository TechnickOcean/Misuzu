import type { AgentMessage } from "@mariozechner/pi-agent-core"
import type { ImageContent, TextContent } from "@mariozechner/pi-ai"
import { compactionMessage } from "./messages/compaction.ts"

const extractText = (c: (ImageContent | TextContent)[]) =>
  c.map((c) => (c.type === "text" ? c.text : "")).join("\n")

export function textFromMessage(msg: AgentMessage) {
  switch (msg.role) {
    case "user":
      return `[User] ${typeof msg.content === "string" ? msg.content : extractText(msg.content)}`
    case "assistant":
      return msg.content
        .map((c) => {
          switch (c.type) {
            case "text":
              return `[Assistant] ${c.text}`
            case "toolCall":
              return `[ToolCall] ${c.name}(${JSON.stringify(c.arguments)})`
            default:
              return ""
          }
        })
        .join("\n")
    case "toolResult":
      return `[ToolResult:${msg.toolName}] details: ${msg.details} content: ${extractText(msg.content)}`
    case "compaction":
      return compactionMessage.compactionContext(msg)
    default:
      return ""
  }
}
