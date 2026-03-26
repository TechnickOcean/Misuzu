import { expect, test, describe } from "vite-plus/test"
import { truncateHead, truncateTail, truncateLine, formatSize } from "./truncate.js"

describe("truncateHead", () => {
  test("returns content unchanged if within limits", () => {
    const result = truncateHead("short content")
    expect(result.truncated).toBe(false)
    expect(result.content).toBe("short content")
  })

  test("truncates by line count", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`)
    const content = lines.join("\n")
    const result = truncateHead(content, { maxLines: 100 })
    expect(result.truncated).toBe(true)
    expect(result.truncatedBy).toBe("lines")
    expect(result.outputLines).toBe(100)
    expect(result.totalLines).toBe(200)
    expect(result.content).toContain("line 1")
    expect(result.content).toContain("line 100")
    expect(result.content).not.toContain("line 101")
  })

  test("truncates by byte count", () => {
    const line = "x".repeat(1000)
    const lines = Array.from({ length: 100 }, () => line).join("\n")
    const result = truncateHead(lines, { maxBytes: 10000 })
    expect(result.truncated).toBe(true)
    expect(result.truncatedBy).toBe("bytes")
    expect(result.outputBytes).toBeLessThanOrEqual(10000)
  })

  test("empty input", () => {
    const result = truncateHead("")
    expect(result.truncated).toBe(false)
    expect(result.outputLines).toBe(0)
  })
})

describe("truncateTail", () => {
  test("returns content unchanged if within limits", () => {
    const result = truncateTail("short content")
    expect(result.truncated).toBe(false)
  })

  test("truncates by line count, keeping end", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`)
    const content = lines.join("\n")
    const result = truncateTail(content, { maxLines: 100 })
    expect(result.truncated).toBe(true)
    expect(result.outputLines).toBe(100)
    expect(result.totalLines).toBe(200)
    expect(result.content).toContain("line 101")
    expect(result.content).toContain("line 200")
    expect(result.content).not.toContain("line 100\n")
  })

  test("truncates by byte count, keeping end", () => {
    const line = "x".repeat(1000)
    const lines = Array.from({ length: 100 }, () => line).join("\n")
    const result = truncateTail(lines, { maxBytes: 10000 })
    expect(result.truncated).toBe(true)
    expect(result.truncatedBy).toBe("bytes")
    expect(result.outputBytes).toBeLessThanOrEqual(10000)
  })
})

describe("truncateLine", () => {
  test("returns line unchanged if within limit", () => {
    expect(truncateLine("short", 100)).toBe("short")
  })

  test("truncates long lines", () => {
    const long = "x".repeat(1000)
    const result = truncateLine(long, 100)
    expect(result.length).toBeLessThanOrEqual(121) // ~100 + truncation notice
    expect(result).toContain("truncated")
  })
})

describe("formatSize", () => {
  test("formats bytes", () => {
    expect(formatSize(500)).toBe("500B")
  })

  test("formats kilobytes", () => {
    expect(formatSize(1024)).toBe("1.0KB")
    expect(formatSize(2048)).toBe("2.0KB")
  })

  test("formats megabytes", () => {
    expect(formatSize(1048576)).toBe("1.0MB")
  })
})
