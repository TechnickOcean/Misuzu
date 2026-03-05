import { describe, expect, test } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { deleteWorkspace, getWorkspace } from "../../../src/tools/workspace/core/manager"
import {
  closeWorkspaceShellManager,
  createAppendKnowledgeTool,
  createEditFileTool,
  createGlobTool,
  createGrepTool,
  createReadFileTool,
  createWorkspaceTool,
  createWriteFileTool
} from "../../../src/tools/workspace/workspace"

type ToolErrorResponse = {
  success: false
  error: {
    code: string
    message: string
    context?: Record<string, unknown>
  }
}

type ToolResponse = ToolErrorResponse | string

const parseToolResponse = (raw: string): ToolResponse => JSON.parse(raw)

const createTestWorkspace = async (title: string) => {
  const tool = createWorkspaceTool
  const raw = await tool.execute(JSON.stringify({ title }))
  const result = parseToolResponse(raw)
  const parsed = typeof result === "string" ? JSON.parse(result) : result
  if (typeof parsed !== "object" || !parsed || !("id" in parsed)) {
    throw new Error("Failed to create workspace")
  }
  const config = await getWorkspace({ id: parsed.id as string })
  return config
}

describe("Workspace Tools - Read/Write/Edit", () => {
  const withWorkspace = async (
    title: string,
    run: (workspace: Awaited<ReturnType<typeof createTestWorkspace>>) => Promise<void>
  ) => {
    const ws = await createTestWorkspace(title)
    try {
      await run(ws)
    } finally {
      try {
        closeWorkspaceShellManager(ws.id)
        await deleteWorkspace({ id: ws.id })
      } catch {}
    }
  }

  test("readFile resolves relative to workspace root", async () => {
    await withWorkspace("readFile root", async (ws) => {
      const subdir = join(ws.path, "subdir")
      await mkdir(subdir, { recursive: true })

      const writeTool = createWriteFileTool(ws.id)
      const writeResult = parseToolResponse(
        await writeTool.execute(JSON.stringify({ file_path: "subdir/note.txt", content: "hello" }))
      )
      expect(writeResult).toBe("Successfully wrote!")

      const readTool = createReadFileTool(ws.id)
      const readResult = parseToolResponse(await readTool.execute(JSON.stringify({ file_path: "subdir/note.txt" })))
      expect(typeof readResult).toBe("string")
      if (typeof readResult === "string") {
        expect(readResult).toContain("hello")
      }
    })
  })

  test("readFile resolves workspace root file", async () => {
    await withWorkspace("readFile root file", async (ws) => {
      const subdir = join(ws.path, "subdir")
      await mkdir(subdir, { recursive: true })

      const writeTool = createWriteFileTool(ws.id)
      const writeResult = parseToolResponse(
        await writeTool.execute(JSON.stringify({ file_path: "root.txt", content: "root content" }))
      )
      expect(writeResult).toBe("Successfully wrote!")

      const readTool = createReadFileTool(ws.id)
      const readResult = parseToolResponse(await readTool.execute(JSON.stringify({ file_path: "root.txt" })))
      expect(typeof readResult).toBe("string")
      if (typeof readResult === "string") {
        expect(readResult).toContain("root content")
      }
    })
  })

  test("readFile reads nested file when path is explicit", async () => {
    await withWorkspace("readFile nested", async (ws) => {
      const subdir = join(ws.path, "subdir")
      await mkdir(subdir, { recursive: true })

      await writeFile(join(subdir, "conflict.txt"), "sub version")
      await writeFile(join(ws.path, "conflict.txt"), "root version")

      const readTool = createReadFileTool(ws.id)
      const readResult = parseToolResponse(await readTool.execute(JSON.stringify({ file_path: "subdir/conflict.txt" })))
      expect(typeof readResult).toBe("string")
      if (typeof readResult === "string") {
        expect(readResult).toContain("sub version")
      }
    })
  })

  test("writeFile creates nested file", async () => {
    await withWorkspace("writeFile nested", async (ws) => {
      const subdir = join(ws.path, "subdir")
      await mkdir(subdir, { recursive: true })

      const writeTool = createWriteFileTool(ws.id)
      const result = parseToolResponse(
        await writeTool.execute(JSON.stringify({ file_path: "subdir/note.txt", content: "content" }))
      )
      expect(result).toBe("Successfully wrote!")

      const readTool = createReadFileTool(ws.id)
      const readResult = parseToolResponse(await readTool.execute(JSON.stringify({ file_path: "subdir/note.txt" })))
      expect(typeof readResult).toBe("string")
      if (typeof readResult === "string") {
        expect(readResult).toContain("content")
      }
    })
  })

  test("editFile replaces content in nested file", async () => {
    await withWorkspace("editFile nested", async (ws) => {
      const subdir = join(ws.path, "subdir")
      await mkdir(subdir, { recursive: true })

      const writeTool = createWriteFileTool(ws.id)
      await writeTool.execute(JSON.stringify({ file_path: "subdir/edit.txt", content: "hello" }))

      const editTool = createEditFileTool(ws.id)
      const editResult = parseToolResponse(
        await editTool.execute(
          JSON.stringify({ file_path: "subdir/edit.txt", old_content: "hello", new_content: "updated" })
        )
      )
      expect(editResult).toBe("Successfully edited!")

      const readTool = createReadFileTool(ws.id)
      const readResult = parseToolResponse(await readTool.execute(JSON.stringify({ file_path: "subdir/edit.txt" })))
      expect(typeof readResult).toBe("string")
      if (typeof readResult === "string") {
        expect(readResult).toContain("updated")
      }
    })
  })

  test("readFile returns NOT_FOUND on missing file", async () => {
    await withWorkspace("readFile not found", async (ws) => {
      const readTool = createReadFileTool(ws.id)
      const result = parseToolResponse(await readTool.execute(JSON.stringify({ file_path: "missing.txt" })))
      expect(typeof result).toBe("object")
      if (typeof result === "object") {
        expect(result.success).toBe(false)
        expect(result.error.code).toBe("NOT_FOUND")
      }
    })
  })

  test("globFiles lists matching files", async () => {
    await withWorkspace("glob files", async (ws) => {
      await writeFile(join(ws.path, "alpha.txt"), "a")
      await writeFile(join(ws.path, "beta.md"), "b")
      await writeFile(join(ws.path, "gamma.txt"), "c")

      const globTool = createGlobTool(ws.id)
      const result = parseToolResponse(await globTool.execute(JSON.stringify({ pattern: "**/*.txt" })))
      expect(typeof result).toBe("string")
      if (typeof result === "string") {
        expect(result).toContain("alpha.txt")
        expect(result).toContain("gamma.txt")
      }
    })
  })

  test("grepFiles finds matches", async () => {
    await withWorkspace("grep files", async (ws) => {
      await writeFile(join(ws.path, "notes.txt"), "hello world\nfind me\n")
      await writeFile(join(ws.path, "other.txt"), "no match")

      const grepTool = createGrepTool(ws.id)
      const result = parseToolResponse(await grepTool.execute(JSON.stringify({ pattern: "find me" })))
      expect(typeof result).toBe("string")
      if (typeof result === "string") {
        expect(result).toContain("notes.txt:2")
      }
    })
  })

  test("appendKnowledge writes entry to knowledge file", async () => {
    await withWorkspace("append knowledge", async (ws) => {
      const appendTool = createAppendKnowledgeTool(ws.id)
      const entry = {
        id: "note-1",
        title: "Test Note",
        summary: "Summary",
        source: "test",
        path: "notes/test.md"
      }
      const result = parseToolResponse(await appendTool.execute(JSON.stringify({ entry })))
      expect(result).toBe("Knowledge entry appended")

      const readTool = createReadFileTool(ws.id)
      const readResult = parseToolResponse(
        await readTool.execute(JSON.stringify({ file_path: ".misuzu/knowledge.json" }))
      )
      expect(typeof readResult).toBe("string")
      if (typeof readResult === "string") {
        const json = readResult.replace(/^\d+\|\s/gm, "")
        expect(json).toContain("Test Note")
        expect(json).toContain("notes/test.md")
      }
    })
  })
})
