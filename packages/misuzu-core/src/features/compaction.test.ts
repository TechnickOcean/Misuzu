import { expect, test, describe } from "vite-plus/test";
import {
  estimateTokens,
  estimateContextTokens,
  findCutPoint,
  compactWithSummary,
} from "./compaction.js";
import type { AgentMessage } from "@mariozechner/pi-agent-core";

function userMsg(content: string, ts = Date.now()): AgentMessage {
  return { role: "user", content, timestamp: ts } as AgentMessage;
}

function assistantMsg(text: string, ts = Date.now()): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: {} as any,
    provider: "test" as any,
    model: "test",
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    stopReason: "stop",
    timestamp: ts,
  } as unknown as AgentMessage;
}

function toolResultMsg(content: string, ts = Date.now()): AgentMessage {
  return {
    role: "toolResult",
    toolCallId: "1",
    toolName: "test",
    content: [{ type: "text", text: content }],
    isError: false,
    timestamp: ts,
  } as AgentMessage;
}

describe("estimateTokens", () => {
  test("estimates user message tokens", () => {
    const msg = userMsg("a".repeat(400));
    expect(estimateTokens(msg)).toBe(100);
  });

  test("estimates assistant message tokens", () => {
    const msg = assistantMsg("a".repeat(800));
    expect(estimateTokens(msg)).toBe(200);
  });

  test("estimates tool result tokens", () => {
    const msg = toolResultMsg("a".repeat(400));
    expect(estimateTokens(msg)).toBe(100);
  });
});

describe("estimateContextTokens", () => {
  test("sums all messages", () => {
    const messages = [userMsg("a".repeat(400)), assistantMsg("a".repeat(800))];
    expect(estimateContextTokens(messages)).toBe(300);
  });

  test("returns 0 for empty array", () => {
    expect(estimateContextTokens([])).toBe(0);
  });
});

describe("findCutPoint", () => {
  test("keeps all messages when context is small", () => {
    const messages = [userMsg("hello"), assistantMsg("hi")];
    const { cutIndex } = findCutPoint(messages);
    expect(cutIndex).toBe(messages.length);
  });

  test("cuts at valid point (user/assistant boundary)", () => {
    // Create messages that exceed KEEP_RECENT_TOKENS (20000)
    const longText = "x".repeat(100_000); // ~25000 tokens
    const messages: AgentMessage[] = [
      userMsg(longText),
      assistantMsg("response 1"),
      toolResultMsg("result 1"),
      userMsg("follow up"),
      assistantMsg("response 2"),
      toolResultMsg("result 2"),
      userMsg("short"),
    ];
    const { cutIndex } = findCutPoint(messages);
    // Should cut somewhere, keeping the last messages
    expect(cutIndex).toBeGreaterThan(0);
    expect(cutIndex).toBeLessThan(messages.length);
    // Should never cut at a toolResult
    expect(messages[cutIndex].role).not.toBe("toolResult");
  });
});

describe("compactWithSummary", () => {
  test("replaces old messages with summary", () => {
    const longText = "x".repeat(100_000);
    const messages: AgentMessage[] = [
      userMsg(longText),
      assistantMsg("response"),
      userMsg("recent question"),
      assistantMsg("recent response"),
    ];
    const result = compactWithSummary(messages, "Summary of old messages");
    expect(result[0].role).toBe("compactionSummary");
    expect(result.length).toBeLessThan(messages.length + 1);
  });

  test("summary message has correct structure", () => {
    const messages = [userMsg("old"), assistantMsg("old"), userMsg("new")];
    const result = compactWithSummary(messages, "Test summary");
    const summary = result[0] as any;
    expect(summary.role).toBe("compactionSummary");
    expect(summary.summary).toBe("Test summary");
    expect(summary.tokensBefore).toBeGreaterThan(0);
  });
});
