import { describe, expect, test } from "vite-plus/test"
import { createWorkspaceLogger, getLogLevelFromEnv } from "./logger.ts"
import type { LogRecord, LogSink } from "./types.ts"

class MemoryLogSink implements LogSink {
  readonly records: LogRecord[] = []

  write(record: LogRecord) {
    this.records.push(record)
  }
}

describe("workspace logger", () => {
  test("redacts sensitive fields in log payload", () => {
    const sink = new MemoryLogSink()
    const logger = createWorkspaceLogger({
      level: "debug",
      context: { component: "test" },
      sinks: [sink],
    })

    logger.info("Testing redaction", {
      apiKey: "super-secret",
      nested: { token: "nested-secret" },
      safe: "visible",
    })

    expect(sink.records).toHaveLength(1)
    expect(sink.records[0].message).toBe("[test] Testing redaction")
    expect(sink.records[0].data).toEqual({
      apiKey: "[REDACTED]",
      nested: { token: "[REDACTED]" },
      safe: "visible",
    })
  })

  test("respects log level and merges child context", () => {
    const sink = new MemoryLogSink()
    const parent = createWorkspaceLogger({
      level: "warn",
      context: { workspaceRoot: "ws-1" },
      sinks: [sink],
    })

    parent.info("This should be ignored")
    parent.child({ component: "agent" }).error("This should be logged")

    expect(sink.records).toHaveLength(1)
    expect(sink.records[0].message).toBe("[agent] This should be logged")
    expect(sink.records[0].context).toEqual({ workspaceRoot: "ws-1", component: "agent" })
  })

  test("always prepends source prefix", () => {
    const sink = new MemoryLogSink()
    const logger = createWorkspaceLogger({
      level: "debug",
      context: { component: "agent" },
      sinks: [sink],
    })

    logger.info("[AlreadyPrefixed] hello")

    expect(sink.records).toHaveLength(1)
    expect(sink.records[0].message).toBe("[agent] [AlreadyPrefixed] hello")
  })

  test("parses log level from env with safe fallback", () => {
    expect(getLogLevelFromEnv({ MISUZU_LOG_LEVEL: "debug" })).toBe("debug")
    expect(getLogLevelFromEnv({ MISUZU_LOG_LEVEL: "info" })).toBe("info")
    expect(getLogLevelFromEnv({ MISUZU_LOG_LEVEL: "unexpected" })).toBe("info")
  })
})
