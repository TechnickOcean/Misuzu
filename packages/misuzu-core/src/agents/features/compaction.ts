import type { Agent, AgentMessage } from "@mariozechner/pi-agent-core"
import type { TextContent } from "@mariozechner/pi-ai"
import { completeSimple } from "@mariozechner/pi-ai"
import { compactionMessageHandler } from "./messages/compaction.ts"
import { textFromMessage } from "./utils.ts"

const RESERVE_TOKENS = 16384
const KEEP_RECENT_TOKENS = 20_000

function buildSummarizePrompt(serialized: string) {
  return `Summarize the following conversation.

Format:

## Goal
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
- [Data, paths, references needed to continue]

Messages:
${serialized}`
}

/** Estimate token count for a message. Uses chars/4 heuristic. */
export function estimateTokens(message: AgentMessage) {
  let chars = 0
  switch (message.role) {
    case "user":
      chars =
        typeof message.content === "string"
          ? message.content.length
          : message.content.reduce((sum, c) => sum + (c.type === "text" ? c.text.length : 4800), 0)
      break
    case "assistant":
      for (const c of message.content) {
        if (c.type === "text") chars += c.text.length
        else if (c.type === "thinking") chars += c.thinking.length
        else if (c.type === "toolCall") chars += c.name.length + JSON.stringify(c.arguments).length
      }
      break
    case "toolResult":
      chars = message.content.reduce(
        (sum, c) => sum + (c.type === "text" ? c.text.length : 4800),
        0,
      )
      break
    case "compaction":
      chars = compactionMessageHandler.calculateToken(message)
      break
  }
  return Math.ceil(chars / 4)
}

/** Estimate total context tokens. Prefers actual usage data when available. */
export function estimateContextTokens(messages: AgentMessage[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === "assistant" && m.usage?.input > 0) {
      const usage = m.usage
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
export function findCutPoint(messages: AgentMessage[]) {
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

/** Serialize messages to text for summarization. */
function serializeForSummary(messages: AgentMessage[]) {
  const parts: string[] = []

  for (const msg of messages) {
    parts.push(textFromMessage(msg))
  }
  return parts.join("\n\n")
}

/**
 * Compact messages: calls LLM to generate summary, returns [summary, ...keptMessages].
 */
export async function compact(agent: Agent) {
  const messages = agent.state.messages
  const cutIndex = findCutPoint(messages)
  const toSummarize = serializeForSummary(messages.slice(0, cutIndex))
  const keptMessages = messages.slice(cutIndex)

  const response = await completeSimple(
    agent.state.model,
    {
      systemPrompt:
        "You are a conversation summarizer. Summarize the conversation. Do not continue the conversation.",
      messages: [
        {
          role: "user",
          content: buildSummarizePrompt(toSummarize),
          timestamp: Date.now(),
        },
      ],
    },
    // thinkingLevel of pi-ai-agent is not equal to that of pi-ai, need to exclude "off"
    { reasoning: agent.state.thinkingLevel === "off" ? "low" : agent.state.thinkingLevel },
  )

  const summaryText = response.content
    .filter((c): c is TextContent => c.type === "text")
    .map((c) => c.text)
    .join("\n")

  const summaryMsg = {
    role: "compaction",
    summary: summaryText,
    tokensBefore: estimateContextTokens(messages),
    timestamp: Date.now(),
  } as AgentMessage

  return [summaryMsg, ...keptMessages]
}

/**
 * Compact with a pre-made summary string (for testing or manual use).
 */
export function compactWithSummary(messages: AgentMessage[], summary: string) {
  const cutIndex = findCutPoint(messages)
  const keptMessages = messages.slice(cutIndex)

  const summaryMsg = {
    role: "compaction",
    summary,
    tokensBefore: estimateContextTokens(messages),
    timestamp: Date.now(),
  }

  return [summaryMsg, ...keptMessages]
}
