import type { Agent, AgentMessage } from "@mariozechner/pi-agent-core";
import type { TextContent, ThinkingContent, ToolCall } from "@mariozechner/pi-ai";

const RESERVE_TOKENS = 16384;
const KEEP_RECENT_TOKENS = 20_000;

function isTextContent(c: unknown): c is TextContent {
  return typeof c === "object" && c !== null && (c as { type: string }).type === "text";
}

function isThinkingContent(c: unknown): c is ThinkingContent {
  return typeof c === "object" && c !== null && (c as { type: string }).type === "thinking";
}

function isToolCall(c: unknown): c is ToolCall {
  return typeof c === "object" && c !== null && (c as { type: string }).type === "toolCall";
}

/** Estimate token count for a message. Uses chars/4 heuristic. */
export function estimateTokens(message: AgentMessage): number {
  let chars = 0;
  switch (message.role) {
    case "user":
      chars =
        typeof message.content === "string"
          ? message.content.length
          : message.content.reduce((sum, c) => sum + (isTextContent(c) ? c.text.length : 4800), 0);
      break;
    case "assistant":
      for (const c of message.content) {
        if (isTextContent(c)) chars += c.text.length;
        else if (isThinkingContent(c)) chars += c.thinking.length;
        else if (isToolCall(c)) chars += c.name.length + JSON.stringify(c.arguments).length;
      }
      break;
    case "toolResult":
      chars = message.content.reduce(
        (sum, c) => sum + (isTextContent(c) ? c.text.length : 4800),
        0,
      );
      break;
    default:
      if ("command" in message && "output" in message) {
        chars = String(message.command).length + String(message.output).length;
      } else if ("summary" in message) {
        chars = String(message.summary).length;
      } else if ("flag" in message) {
        chars = String(message.flag).length + String(message.message).length;
      } else if ("details" in message) {
        chars = String(message.details).length;
      }
      break;
  }
  return Math.ceil(chars / 4);
}

/** Estimate total context tokens across all messages. */
export function estimateContextTokens(messages: AgentMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m), 0);
}

/** Check if compaction should trigger. */
export function checkCompact(agent: Agent): boolean {
  const contextWindow = agent.state.model?.contextWindow ?? 128_000;
  const totalTokens = estimateContextTokens(agent.state.messages);
  return totalTokens > contextWindow - RESERVE_TOKENS;
}

interface CutPointResult {
  cutIndex: number;
  totalEstimatedTokens: number;
}

/**
 * Find where to cut the message array.
 * Walks backwards from the newest message, accumulating tokens.
 * Returns the index after the last valid cut point before exceeding KEEP_RECENT_TOKENS.
 */
export function findCutPoint(messages: AgentMessage[]): CutPointResult {
  let accumulated = 0;
  let prevValidCut = messages.length;

  for (let i = messages.length - 1; i >= 0; i--) {
    const isCutPoint = messages[i].role === "user" || messages[i].role === "assistant";
    accumulated += estimateTokens(messages[i]);

    if (accumulated > KEEP_RECENT_TOKENS) {
      return { cutIndex: prevValidCut, totalEstimatedTokens: accumulated };
    }

    if (isCutPoint) {
      prevValidCut = i;
    }
  }

  return { cutIndex: messages.length, totalEstimatedTokens: accumulated };
}

function textFromContent(content: unknown[]): string {
  return content
    .filter(isTextContent)
    .map((c) => c.text)
    .join("\n");
}

/** Serialize messages to text for summarization. */
function serializeForSummary(messages: AgentMessage[]): string {
  const parts: string[] = [];

  for (const msg of messages) {
    switch (msg.role) {
      case "user": {
        const text = typeof msg.content === "string" ? msg.content : textFromContent(msg.content);
        parts.push(`[User]: ${text.slice(0, 2000)}`);
        break;
      }
      case "assistant": {
        const textParts = msg.content.filter(isTextContent).map((c) => c.text);
        if (textParts.length) parts.push(`[Assistant]: ${textParts.join("\n").slice(0, 2000)}`);
        const toolCalls = msg.content.filter(isToolCall);
        if (toolCalls.length) {
          const calls = toolCalls
            .map((tc) => `${tc.name}(${JSON.stringify(tc.arguments).slice(0, 200)})`)
            .join("; ");
          parts.push(`[Tool calls]: ${calls}`);
        }
        break;
      }
      case "toolResult": {
        const text = textFromContent(msg.content);
        parts.push(`[Tool result]: ${text.slice(0, 2000)}`);
        break;
      }
    }
  }

  return parts.join("\n\n");
}

/**
 * Prepare compaction: returns the text to summarize and the messages to keep.
 */
export function prepareCompaction(messages: AgentMessage[]): {
  toSummarize: string;
  keptMessages: AgentMessage[];
} {
  const { cutIndex } = findCutPoint(messages);
  return {
    toSummarize: serializeForSummary(messages.slice(0, cutIndex)),
    keptMessages: messages.slice(cutIndex),
  };
}

/**
 * Full compaction: replaces messages with summary + kept messages.
 */
export function compactWithSummary(messages: AgentMessage[], summary: string): AgentMessage[] {
  const { keptMessages } = prepareCompaction(messages);

  const summaryMsg = {
    role: "compactionSummary" as const,
    summary,
    tokensBefore: estimateContextTokens(messages),
    timestamp: Date.now(),
  } as unknown as AgentMessage;

  return [summaryMsg, ...keptMessages];
}
