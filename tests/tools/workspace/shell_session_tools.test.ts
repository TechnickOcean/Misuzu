import { describe, expect, test } from "bun:test"
import { deleteWorkspace, getWorkspace } from "../../../src/tools/workspace/core/manager"
import { ShellManager } from "../../../src/tools/workspace/shell_manager"
import {
  closeWorkspaceShellManager,
  createShellSessionTools,
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

const createTestWorkspace = async (title: string) => {
  const tool = createWorkspaceTool
  const raw = await tool.execute(JSON.stringify({ title }))
  const result = parseToolResponse(raw)
  const parsed = typeof result === "string" ? JSON.parse(result) : result
  if (typeof parsed !== "object" || !parsed || !("id" in parsed)) {
    throw new Error("Failed to create workspace")
  }
  return getWorkspace({ id: parsed.id as string })
}

describe("Workspace Tools - Shell Sessions", () => {
  test("create/list/exec/read/kill terminal", async () => {
    const ws = await createTestWorkspace("shell sessions")
    const manager = new ShellManager(ws.path)
    const tools = createShellSessionTools(manager)
    const createTerminal = tools.find((tool) => tool.name === "create_terminal")
    const listTerminals = tools.find((tool) => tool.name === "list_terminals")
    const execTerminal = tools.find((tool) => tool.name === "exec_terminal")
    const readTerminal = tools.find((tool) => tool.name === "read_terminal")
    const killTerminal = tools.find((tool) => tool.name === "kill_terminal")

    if (!createTerminal || !listTerminals || !execTerminal || !readTerminal || !killTerminal) {
      throw new Error("Missing terminal tools")
    }

    const created = parseToolResponse(await createTerminal.execute(JSON.stringify({ name: "test" })))
    expect(typeof created).toBe("string")
    const createdObj = typeof created === "string" ? JSON.parse(created) : created
    if (typeof createdObj !== "object" || !createdObj || !("session_id" in createdObj)) {
      throw new Error("Failed to create terminal")
    }
    const sessionId = createdObj.session_id as string

    const listed = parseToolResponse(await listTerminals.execute(JSON.stringify({})))
    expect(typeof listed).toBe("string")
    if (typeof listed === "string") {
      expect(listed).toContain(sessionId)
    }

    const execResult = parseToolResponse(
      await execTerminal.execute(JSON.stringify({ session_id: sessionId, command: "echo hello" }))
    )
    expect(typeof execResult).toBe("string")
    if (typeof execResult === "string") {
      expect(execResult).toContain("hello")
    }

    const readResult = parseToolResponse(await readTerminal.execute(JSON.stringify({ session_id: sessionId })))
    expect(typeof readResult).toBe("string")

    const killResult = parseToolResponse(await killTerminal.execute(JSON.stringify({ session_id: sessionId })))
    expect(killResult).toBe("Terminal session killed")

    manager.closeAll()
    closeWorkspaceShellManager(ws.id)
    const shellTool = createShellTool(ws.id)
    await shellTool.execute(JSON.stringify({ command: "exit" }))
    closeWorkspaceShellManager(ws.id)
    await deleteWorkspace({ id: ws.id })
  })
})
