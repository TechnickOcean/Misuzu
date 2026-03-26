import type { Agent, AgentMessage } from "@mariozechner/pi-agent-core"
import type { AssistantMessage, TextContent, ThinkingContent, ToolCall } from "@mariozechner/pi-ai"
import { completeSimple } from "@mariozechner/pi-ai"

const RESERVE_TOKENS = 16384
const KEEP_RECENT_TOKENS = 20_000

function isTextContent(c: unknown): c is TextContent {
  return typeof c === "object" && c !== null && (c as { type: string }).type === "text"
}

function isToolCall(c: unknown): c is ToolCall {
  return typeof c === "object" && c !== null && (c as { type: string }).type === "toolCall"
}

/** Estimate token count for a message. Uses chars/4 heuristic. */
export function estimateTokens(message: AgentMessage): number {
  let chars = 0
  switch (message.role) {
    case "user":
      chars =
        typeof message.content === "string"
          ? message.content.length
          : message.content.reduce((sum, c) => sum + (isTextContent(c) ? c.text.length : 4800), 0)
      break
    case "assistant":
      for (const c of message.content) {
        if (isTextContent(c)) chars += c.text.length
        else if ((c as ThinkingContent).type === "thinking")
          chars += (c as ThinkingContent).thinking.length
        else if (isToolCall(c)) chars += c.name.length + JSON.stringify(c.arguments).length
      }
      break
    case "toolResult":
      chars = message.content.reduce((sum, c) => sum + (isTextContent(c) ? c.text.length : 4800), 0)
      break
    default:
      if ("command" in message && "output" in message) {
        chars = String(message.command).length + String(message.output).length
      } else if ("summary" in message) {
        chars = String(message.summary).length
      } else if ("flag" in message) {
        chars = String(message.flag).length + String(message.message).length
      } else if ("details" in message) {
        chars = String(message.details).length
      }
      break
  }
  return Math.ceil(chars / 4)
}

/** Estimate total context tokens. Prefers actual usage data when available. */
export function estimateContextTokens(messages: AgentMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === "assistant" && (m as AssistantMessage).usage?.input > 0) {
      const usage = (m as AssistantMessage).usage
      const usageTokens = usage.input + usage.cacheRead + usage.cacheWrite
      let trailingTokens = 0
      for (let j = i + 1; j < messages.length; j++) {
        trailingTokens += estimateTokens(messages[j])
      }
      return usageTokens + trailingTokens
    }
  }
  return messages.reduce((sum, m) => sum + estimateTokens(m), 0)
}

/** Check if compaction should trigger. */
export function checkCompact(agent: Agent): boolean {
  const contextWindow = agent.state.model?.contextWindow ?? 128_000
  return estimateContextTokens(agent.state.messages) > contextWindow - RESERVE_TOKENS
}

/**
 * Find where to cut the message array.
 * Walks backwards, accumulating tokens. When exceeding KEEP_RECENT_TOKENS,
 * snaps to nearest valid cut point. Only toolResult is invalid (must stay with its tool call).
 */
export function findCutPoint(messages: AgentMessage[]): number {
  let accumulated = 0
  let prevValidCut = messages.length

  for (let i = messages.length - 1; i >= 0; i--) {
    accumulated += estimateTokens(messages[i])

    if (accumulated > KEEP_RECENT_TOKENS) {
      return prevValidCut
    }

    if (messages[i].role !== "toolResult") {
      prevValidCut = i
    }
  }

  return messages.length
}

function textFromContent(content: unknown[]): string {
  return content
    .filter(isTextContent)
    .map((c) => c.text)
    .join("\n")
}

/** Serialize messages to text for summarization. */
function serializeForSummary(messages: AgentMessage[]): string {
  const parts: string[] = []

  for (const msg of messages) {
    switch (msg.role) {
      case "user": {
        const text = typeof msg.content === "string" ? msg.content : textFromContent(msg.content)
        parts.push(`[User]: ${text.slice(0, 2000)}`)
        break
      }
      case "assistant": {
        const textParts = msg.content.filter(isTextContent).map((c) => c.text)
        if (textParts.length) parts.push(`[Assistant]: ${textParts.join("\n").slice(0, 2000)}`)
        const toolCalls = msg.content.filter(isToolCall)
        if (toolCalls.length) {
          const calls = toolCalls
            .map((tc) => `${tc.name}(${JSON.stringify(tc.arguments).slice(0, 200)})`)
            .join("; ")
          parts.push(`[Tool calls]: ${calls}`)
        }
        break
      }
      case "toolResult": {
        parts.push(`[Tool result]: ${textFromContent(msg.content).slice(0, 2000)}`)
        break
      }
      default:
        if ("summary" in msg) {
          parts.push(`[Previous summary]: ${String(msg.summary).slice(0, 2000)}`)
        } else if ("flag" in msg) {
          parts.push(`[Flag]: ${msg.flag} - ${msg.message}`)
        } else if ("details" in msg) {
          parts.push(`[Challenge]: ${msg.details}`)
        }
        break
    }
  }

  return parts.join("\n\n")
}

const SUMMARY_FORMAT = `## Goal
[What is the user trying to accomplish?]

## Constraints & Preferences
- [Any constraints mentioned]
Or "(none)"

## Progress
### Done
- [x] [Completed tasks]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress]

## Key Findings
- **[Finding]**: [Description]

## Critical Context
- [Data, paths, references needed to continue]`

function buildSummarizePrompt(serialized: string, previousSummary?: string): string {
  if (previousSummary) {
    return `Merge the following NEW messages into the existing summary. PRESERVE existing info, ADD new progress, UPDATE "Next Steps".

<previous-summary>
${previousSummary}
</previous-summary>

Format:
${SUMMARY_FORMAT}

NEW messages:
${serialized}`
  }

  return `Summarize the following conversation.

Format:
${SUMMARY_FORMAT}

Messages:
${serialized}`
}

/**
 * Compact messages: calls LLM to generate summary, returns [summary, ...keptMessages].
 */
export async function compact(agent: Agent): Promise<AgentMessage[]> {
  const messages = agent.state.messages
  const cutIndex = findCutPoint(messages)
  const toSummarize = serializeForSummary(messages.slice(0, cutIndex))
  const keptMessages = messages.slice(cutIndex)

  let previousSummary: string | undefined
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as any
    if (m.role === "compactionSummary" && m.summary) {
      previousSummary = m.summary
      break
    }
  }

  const response = await completeSimple(
    agent.state.model,
    {
      systemPrompt:
        "You are a conversation summarizer. Output ONLY the summary. Do not continue the conversation.",
      messages: [
        {
          role: "user",
          content: buildSummarizePrompt(toSummarize, previousSummary),
          timestamp: Date.now(),
        },
      ],
    },
    { reasoning: "minimal" },
  )

  const summaryText = response.content
    .filter((c): c is TextContent => c.type === "text")
    .map((c) => c.text)
    .join("\n")

  const summaryMsg = {
    role: "compactionSummary" as const,
    summary: summaryText,
    tokensBefore: estimateContextTokens(messages),
    timestamp: Date.now(),
  } as unknown as AgentMessage

  return [summaryMsg, ...keptMessages]
}

/**
 * Compact with a pre-made summary string (for testing or manual use).
 */
export function compactWithSummary(messages: AgentMessage[], summary: string): AgentMessage[] {
  const cutIndex = findCutPoint(messages)
  const keptMessages = messages.slice(cutIndex)

  const summaryMsg = {
    role: "compactionSummary" as const,
    summary,
    tokensBefore: estimateContextTokens(messages),
    timestamp: Date.now(),
  } as unknown as AgentMessage

  return [summaryMsg, ...keptMessages]
}
