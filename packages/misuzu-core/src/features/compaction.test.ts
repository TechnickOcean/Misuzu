import { expect, test, describe } from "vite-plus/test"
import {
  estimateTokens,
  estimateContextTokens,
  findCutPoint,
  compactWithSummary,
} from "./compaction.js"
import type { AgentMessage } from "@mariozechner/pi-agent-core"

function user(content: string): AgentMessage {
  return { role: "user", content, timestamp: Date.now() } as AgentMessage
}

function assistant(
  text: string,
  usage?: { input: number; output: number; cacheRead: number; cacheWrite: number },
): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: {} as any,
    provider: "test",
    model: "test",
    usage: usage
      ? {
          ...usage,
          totalTokens: usage.input + usage.output,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        }
      : {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
    stopReason: "stop",
    timestamp: Date.now(),
  } as unknown as AgentMessage
}

function toolResult(content: string): AgentMessage {
  return {
    role: "toolResult",
    toolCallId: "1",
    toolName: "test",
    content: [{ type: "text", text: content }],
    isError: false,
    timestamp: Date.now(),
  } as AgentMessage
}

describe("estimateTokens", () => {
  test("user", () => {
    expect(estimateTokens(user("a".repeat(400)))).toBe(100)
  })

  test("assistant", () => {
    expect(estimateTokens(assistant("a".repeat(800)))).toBe(200)
  })

  test("toolResult", () => {
    expect(estimateTokens(toolResult("a".repeat(400)))).toBe(100)
  })
})

describe("estimateContextTokens", () => {
  test("sums all messages", () => {
    expect(estimateContextTokens([user("a".repeat(400)), assistant("a".repeat(800))])).toBe(300)
  })

  test("empty array", () => {
    expect(estimateContextTokens([])).toBe(0)
  })

  test("prefers actual usage over heuristic", () => {
    const messages = [
      user("a".repeat(400)),
      assistant("response", { input: 5000, output: 500, cacheRead: 1000, cacheWrite: 0 }),
    ]
    // 5000 + 1000 + 0 = 6000 (no trailing messages)
    expect(estimateContextTokens(messages)).toBe(6000)
  })

  test("estimates trailing messages after last usage", () => {
    const messages = [
      assistant("old", { input: 5000, output: 500, cacheRead: 0, cacheWrite: 0 }),
      user("a".repeat(400)),
    ]
    // 5000 + 1000 trailing = 5100
    expect(estimateContextTokens(messages)).toBe(5100)
  })
})

describe("findCutPoint", () => {
  test("keeps all when context is small", () => {
    expect(findCutPoint([user("hello"), assistant("hi")])).toBe(2)
  })

  test("cuts at user/assistant boundary, never at toolResult", () => {
    const long = "x".repeat(100_000) // ~25k tokens, exceeds KEEP_RECENT_TOKENS
    const messages: AgentMessage[] = [
      user(long),
      assistant("r1"),
      toolResult("t1"),
      user("r2"),
      assistant("r3"),
      toolResult("t2"),
      user("recent"),
    ]
    const idx = findCutPoint(messages)
    expect(idx).toBeGreaterThan(0)
    expect(idx).toBeLessThan(messages.length)
    expect(messages[idx].role).not.toBe("toolResult")
  })
})

describe("compactWithSummary", () => {
  test("replaces old messages with summary", () => {
    const messages: AgentMessage[] = [
      user("x".repeat(100_000)),
      assistant("r1"),
      user("recent"),
      assistant("recent r"),
    ]
    const result = compactWithSummary(messages, "Summary")
    expect(result[0].role).toBe("compactionSummary")
    expect(result.length).toBeLessThan(messages.length + 1)
  })

  test("summary has correct fields", () => {
    const messages = [user("old"), assistant("old"), user("new")]
    const summary = compactWithSummary(messages, "Test summary")[0] as any
    expect(summary.role).toBe("compactionSummary")
    expect(summary.summary).toBe("Test summary")
    expect(summary.tokensBefore).toBeGreaterThan(0)
  })
})
