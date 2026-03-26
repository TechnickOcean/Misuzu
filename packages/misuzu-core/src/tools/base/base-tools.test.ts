import { expect, test, describe, beforeEach, afterEach } from "vite-plus/test"
import { mkdir, writeFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createReadTool } from "./read.js"
import { createWriteTool } from "./write.js"
import { createEditTool } from "./edit.js"
import { createBashTool } from "./bash.js"

let testDir: string

function textOf(content: { type: string; text?: string; data?: string }[]): string {
  return content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("")
}

beforeEach(async () => {
  testDir = join(tmpdir(), `misuzu-test-${Date.now()}`)
  await mkdir(testDir, { recursive: true })
})

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true })
})

describe("write tool", () => {
  test("creates a file with content", async () => {
    const tool = createWriteTool(testDir)
    const result = await tool.execute("id", { path: "test.txt", content: "hello" })
    expect(textOf(result.content)).toContain("written")
  })

  test("creates nested directories", async () => {
    const tool = createWriteTool(testDir)
    const result = await tool.execute("id", { path: "a/b/c.txt", content: "nested" })
    expect(textOf(result.content)).toContain("written")
  })
})

describe("read tool", () => {
  test("reads a file", async () => {
    const filePath = join(testDir, "read-test.txt")
    await writeFile(filePath, "line1\nline2\nline3\n", "utf-8")

    const tool = createReadTool(testDir)
    const result = await tool.execute("id", { path: "read-test.txt" })
    const t = textOf(result.content)
    expect(t).toContain("line1")
    expect(t).toContain("line3")
  })

  test("reads with offset", async () => {
    const filePath = join(testDir, "offset-test.txt")
    await writeFile(filePath, "line1\nline2\nline3\n", "utf-8")

    const tool = createReadTool(testDir)
    const result = await tool.execute("id", { path: "offset-test.txt", offset: 2 })
    const t = textOf(result.content)
    expect(t).toContain("line2")
    expect(t).toContain("line3")
  })

  test("reads with limit", async () => {
    const filePath = join(testDir, "limit-test.txt")
    await writeFile(filePath, "line1\nline2\nline3\nline4\nline5\n", "utf-8")

    const tool = createReadTool(testDir)
    const result = await tool.execute("id", { path: "limit-test.txt", limit: 2 })
    const t = textOf(result.content)
    expect(t).toContain("line1")
    expect(t).toContain("line2")
    expect(t).not.toContain("line3")
  })

  test("throws on missing file", async () => {
    const tool = createReadTool(testDir)
    await expect(tool.execute("id", { path: "nonexistent.txt" })).rejects.toThrow("File not found")
  })
})

describe("edit tool", () => {
  test("replaces text in file", async () => {
    const filePath = join(testDir, "edit-test.txt")
    await writeFile(filePath, "hello world\n", "utf-8")

    const tool = createEditTool(testDir)
    const result = await tool.execute("id", {
      path: "edit-test.txt",
      oldText: "world",
      newText: "misuzu",
    })
    expect(textOf(result.content)).toContain("edited")
    expect(result.details!.diff).toContain("- world")
    expect(result.details!.diff).toContain("+ misuzu")
  })

  test("throws on missing text", async () => {
    const filePath = join(testDir, "edit-miss.txt")
    await writeFile(filePath, "hello world\n", "utf-8")

    const tool = createEditTool(testDir)
    await expect(
      tool.execute("id", { path: "edit-miss.txt", oldText: "notfound", newText: "x" }),
    ).rejects.toThrow("Could not find")
  })

  test("throws on multiple matches", async () => {
    const filePath = join(testDir, "edit-multi.txt")
    await writeFile(filePath, "aaa\naaa\n", "utf-8")

    const tool = createEditTool(testDir)
    await expect(
      tool.execute("id", { path: "edit-multi.txt", oldText: "aaa", newText: "bbb" }),
    ).rejects.toThrow("Found 2 occurrences")
  })
})

describe("bash tool", () => {
  test("executes a simple command", async () => {
    const tool = createBashTool(testDir)
    const result = await tool.execute("id", { command: "echo hello" })
    expect(textOf(result.content)).toContain("hello")
    expect(result.details!.exitCode).toBe(0)
  })

  test("captures stderr", async () => {
    const tool = createBashTool(testDir)
    const result = await tool.execute("id", { command: 'Write-Error "This is an error message"' })
    expect(textOf(result.content)).toContain("err")
  })

  test("throws on non-zero exit and includes output", async () => {
    const tool = createBashTool(testDir)
    try {
      await tool.execute("id", { command: "echo fail; exit 1" })
    } catch (e: any) {
      expect(e.message).toContain("fail")
    }
  })
})
