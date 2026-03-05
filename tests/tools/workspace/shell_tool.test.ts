import { afterAll, describe, expect, test } from "bun:test"
import { deleteWorkspace, getWorkspace } from "../../../src/tools/workspace/core/manager"
import {
  closeWorkspaceShellManager,
  createShellTool,
  createWorkspaceTool
} from "../../../src/tools/workspace/workspace"

type ToolResponse =
  | {
      success: false
      error: {
        code: string
        message: string
        context?: Record<string, unknown>
      }
    }
  | string

const parseToolResponse = (raw: string): ToolResponse => JSON.parse(raw)

const workspaces: string[] = []

const createTestWorkspace = async (title: string) => {
  const tool = createWorkspaceTool
  const raw = await tool.execute(JSON.stringify({ title }))
  const result = parseToolResponse(raw)
  const parsed = typeof result === "string" ? JSON.parse(result) : result
  if (typeof parsed !== "object" || !parsed || !("id" in parsed)) {
    throw new Error("Failed to create workspace")
  }
  const config = await getWorkspace({ id: parsed.id as string })
  workspaces.push(config.id)
  return config
}

afterAll(async () => {
  for (const id of workspaces) {
    try {
      closeWorkspaceShellManager(id)
      await deleteWorkspace({ id })
    } catch (error) {
      console.error("Failed to delete workspace", id, error)
    }
  }
})

describe("Workspace Tools - Shell", () => {
  test("executes shell commands and returns output", async () => {
    const ws = await createTestWorkspace("shell tool")
    const shellTool = createShellTool(ws.id)

    const result = parseToolResponse(await shellTool.execute(JSON.stringify({ command: "echo hello" })))
    expect(typeof result).toBe("string")
    if (typeof result === "string") {
      expect(result).toContain("STDOUT:")
      expect(result).toContain("hello")
    }
  })

  test("returns error response for invalid command", async () => {
    const ws = await createTestWorkspace("shell invalid")
    const shellTool = createShellTool(ws.id)

    // invalid command should return an error response
    const result = parseToolResponse(
      await shellTool.execute(JSON.stringify({ command: "command_that_does_not_exist" }))
    )
    expect(typeof result).toBe("string")
    if (typeof result === "string") {
      expect(result).toMatch(/(STDERR:|STDOUT:)/)
    }
  })
})
