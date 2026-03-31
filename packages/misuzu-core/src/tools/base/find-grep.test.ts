import { describe, expect, test, beforeEach, afterEach } from "vite-plus/test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { createFindTool } from "./find.js"
import { createGrepTool } from "./grep.js"

function textOf(content: { type: string; text?: string }[]) {
  return content
    .filter((entry): entry is { type: "text"; text: string } => entry.type === "text")
    .map((entry) => entry.text)
    .join("")
}

describe("find and grep tools", () => {
  let testDir = ""

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "misuzu-tools-"))
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  test("find returns truncated content for oversized output", async () => {
    const longName = "a".repeat(600)
    const longResults = Array.from({ length: 400 }, (_, index) => `${longName}-${index}.ts`)

    const tool = createFindTool(testDir, {
      operations: {
        stat: async () => ({ isDirectory: () => true }),
        glob: async () => longResults,
      },
    })

    const result = await tool.execute("id", { pattern: "*.ts" })
    const text = textOf(result.content)

    expect(text.length).toBeLessThan(55000)
    expect(text).toContain(`${longName}-0.ts`)
    expect(text).not.toContain(`${longName}-399.ts`)
    expect(result.details?.truncation?.truncated).toBe(true)
  })

  test("find resolves @-prefixed paths relative to cwd", async () => {
    let capturedPath = ""

    const tool = createFindTool(testDir, {
      operations: {
        stat: async (path) => {
          capturedPath = path
          return { isDirectory: () => true }
        },
        glob: async () => [],
      },
    })

    await tool.execute("id", { pattern: "*.ts", path: "@subdir" })
    expect(capturedPath).toBe(resolve(testDir, "subdir"))
  })

  test("grep returns context lines when requested", async () => {
    const filePath = join(testDir, "sample.txt")
    await writeFile(filePath, "one\ntwo\nneedle\nfour\nfive\n", "utf-8")

    const tool = createGrepTool(testDir)
    const result = await tool.execute("id", {
      pattern: "needle",
      literal: true,
      path: ".",
      context: 1,
    })

    const text = textOf(result.content)
    expect(text).toContain("sample.txt-2-two")
    expect(text).toContain("sample.txt:3:needle")
    expect(text).toContain("sample.txt-4-four")
  })
})
