import { describe, expect, test } from "vite-plus/test"
import type { AgentMessage } from "@mariozechner/pi-agent-core"
import { convertToLlm } from "./messages.js"

describe("messages convertToLlm", () => {
  test("renders schedulerUpdate as user-visible scheduler event", () => {
    const messages = [
      {
        role: "schedulerUpdate",
        challengeId: "crypto-102",
        challengeName: "Small e",
        status: "started",
        reason: "slot_freed_auto_dispatch",
        queueBefore: 2,
        queueAfter: 1,
        model: "rightcode/gpt-5.4",
        timestamp: 123,
      },
    ] as AgentMessage[]

    const converted = convertToLlm(messages)
    expect(converted.length).toBe(1)
    expect(converted[0].role).toBe("user")
    const { content } = converted[0]
    expect(typeof content).toBe("string")
    if (typeof content !== "string") {
      throw new Error("Expected schedulerUpdate conversion to produce string content")
    }
    expect(content).toContain("Scheduler STARTED")
    expect(content).toContain("queue 2->1")
    expect(content).toContain("model=rightcode/gpt-5.4")
  })
})
