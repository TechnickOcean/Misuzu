import { join } from "node:path"
import { file, Glob } from "bun"
import * as z from "zod"
import { AppError } from "@/utils/errors"
import BaseFunctionTool from "../base/FunctionTool"
import { appendWorkspaceKnowledge, createWorkspace, getWorkspace } from "./core/manager"
import { ShellManager } from "./shell_manager"

const MAX_OUTPUT_CHARS = 2000
const globalShellManagers = new Map<string, ShellManager>()

export function closeWorkspaceShellManager(workspace_id: string) {
  const manager = globalShellManagers.get(workspace_id)
  if (!manager) return
  manager.closeAll()
  globalShellManagers.delete(workspace_id)
}

export async function resolveFilePath(
  workspace_id: string,
  file_path: string,
  mode: "read" | "write" = "read",
  // Dependency injection for testing
  injectedContext?: { rootPath: string; cwd?: string }
): Promise<string> {
  let rootPath: string
  let cwd: string

  if (injectedContext) {
    rootPath = injectedContext.rootPath
    cwd = injectedContext.cwd || rootPath
  } else {
    const manager = globalShellManagers.get(workspace_id)
    const session = manager?.listSessions().find((s) => s.name === "default")
    const workspace = await getWorkspace({ id: workspace_id })
    rootPath = workspace.path
    cwd = session ? session.cwd : rootPath
  }

  // Normalize file_path to be relative (strip leading / or \)
  const cleanPath = file_path.replace(/^[\\/]+/, "")

  // Mode write: Always resolve relative to CWD (or root if no session)
  if (mode === "write") {
    return join(cwd, cleanPath)
  }

  // Mode read: Try resolving against CWD first
  const cwdTarget = join(cwd, cleanPath)
  if (await file(cwdTarget).exists()) {
    return cwdTarget
  }

  // Fallback: Try resolving against Workspace Root
  const rootTarget = join(rootPath, cleanPath)
  if (await file(rootTarget).exists()) {
    return rootTarget
  }

  // Default to CWD path for error message consistency if not found
  return cwdTarget
}

export const createWorkspaceTool = new BaseFunctionTool({
  name: "createWorkspace",
  description:
    "Create a persistent workspace directory for a task or challenge. Returns a `workspace_id` for use with other tools.",
  schema: z.object({
    title: z.string().meta({ description: "Descriptive title for the workspace." })
  }),
  func: async ({ title }: { title: string }) => createWorkspace({ title })
})

export const createReadFileTool = (workspace_id: string) => {
  async function readFile({ file_path, offset, limit }: { file_path: string; offset?: number; limit?: number }) {
    const targetPath = await resolveFilePath(workspace_id, file_path, "read")
    const target = file(targetPath)
    if (!(await target.exists())) {
      throw new AppError("NOT_FOUND", "File does not exist", { file_path })
    }
    if (target.size >= 20000) {
      throw new AppError("UPSTREAM_ERROR", "File too large to read", { file_path, size: target.size })
    }
    const raw = (await target.text()).split("\n")
    const lines = []
    for (let i = 1; i <= raw.length; i++) lines.push(`${i}| ${raw[i - 1]}`)
    if (offset && limit) {
      return lines.slice(offset, offset + limit).join("\n")
    }
    if (target.size >= MAX_OUTPUT_CHARS) {
      let sum = 0
      let cnt = 0
      for (const line of lines) {
        sum += line.length
        if (sum >= MAX_OUTPUT_CHARS) break
        cnt += 1
      }
      return `${lines.slice(0, cnt + 1).join("\n")}\n[TOOLTIP] The content is too long (${lines.length} lines in total), add offset and limit to read next contents.`
    }
    return lines.join("\n")
  }

  return new BaseFunctionTool({
    name: "readFile",
    description: "Read file contents with line numbers. Use `offset` and `limit` for large files.",
    schema: z.object({
      file_path: z.string().meta({ description: "Path to the target file." }),
      offset: z.optional(z.number()).meta({
        description: "Start index (0-based) for reading lines."
      }),
      limit: z.optional(z.number()).meta({ description: "Maximum number of lines to read." })
    }),
    func: readFile
  })
}

export const createWriteFileTool = (workspace_id: string) => {
  async function writeFile({ file_path, content }: { file_path: string; content: string }) {
    const targetPath = await resolveFilePath(workspace_id, file_path, "write")
    const target = file(targetPath)
    if (await target.exists()) {
      throw new AppError("CONFLICT", "File already exists", { file_path })
    }
    await target.write(content)
    return "Successfully wrote!"
  }

  return new BaseFunctionTool({
    name: "writeFile",
    description: "Create a new file with the specified content. Fails if the file already exists.",
    schema: z.object({
      file_path: z.string().meta({ description: "Path to the new file." }),
      content: z.string().meta({ description: "Content to write." })
    }),
    func: writeFile
  })
}

export const createEditFileTool = (workspace_id: string) => {
  async function editFile({
    file_path,
    old_content,
    new_content
  }: {
    file_path: string
    old_content: string
    new_content: string
  }) {
    const targetPath = await resolveFilePath(workspace_id, file_path, "read")
    const target = file(targetPath)
    if (!(await target.exists())) {
      throw new AppError("NOT_FOUND", "File does not exist", { file_path })
    }
    const content = await target.text()
    if (!content.includes(old_content)) {
      throw new AppError("NOT_FOUND", "old_content not found", { file_path })
    }
    await target.write(content.replace(old_content, new_content))
    return "Successfully edited!"
  }

  return new BaseFunctionTool({
    name: "editFile",
    description: "Edit a file by replacing `old_content` with `new_content`.",
    schema: z.object({
      file_path: z.string().meta({ description: "Path to the file to edit." }),
      old_content: z.string().meta({ description: "Unique string in the file to be replaced." }),
      new_content: z.string().meta({ description: "String to replace with." })
    }),
    func: editFile
  })
}

export const createGlobTool = (workspace_id: string) => {
  async function globFiles({ pattern }: { pattern: string }) {
    const basePath = (await getWorkspace({ id: workspace_id })).path

    const glob = new Glob(pattern)
    const files: string[] = []
    let sum = 0

    for await (const file of glob.scan({ cwd: basePath, absolute: false })) {
      const nextLen = file.length + 1
      if (sum + nextLen > MAX_OUTPUT_CHARS) {
        files.push("... (list truncated, refine your pattern)")
        break
      }
      files.push(file)
      sum += nextLen
    }
    return files.join("\n") || "(no files found)"
  }

  return new BaseFunctionTool({
    name: "globFiles",
    description: "List files matching a glob pattern.",
    schema: z.object({
      pattern: z.string().meta({ description: "Glob pattern (e.g., `**/*.ts`)." })
    }),
    func: globFiles
  })
}

export const createGrepTool = (workspace_id: string) => {
  async function grepFiles({ pattern }: { pattern: string }) {
    const basePath = (await getWorkspace({ id: workspace_id })).path

    const glob = new Glob("**/*")
    const matches: string[] = []
    let sum = 0

    const regex = new RegExp(pattern)

    for await (const f of glob.scan({ cwd: basePath, absolute: false })) {
      const target = file(join(basePath, f))
      if (target.size > 1024 * 1024) continue
      try {
        const content = await target.text()
        const lines = content.split("\n")
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index] ?? ""
          if (regex.test(line)) {
            const match = `${f}:${index + 1}:${line.trim()}`
            const nextLen = match.length + 1
            if (sum + nextLen > MAX_OUTPUT_CHARS) {
              matches.push("... (matches truncated, refine your pattern)")
              return matches.join("\n")
            }
            matches.push(match)
            sum += nextLen
          }
        }
      } catch (_e) {}
    }

    return matches.join("\n") || "No matches found."
  }

  return new BaseFunctionTool({
    name: "grepFiles",
    description: "Search for a string or regex pattern in file contents.",
    schema: z.object({
      pattern: z.string().meta({ description: "String or regex pattern to search for." })
    }),
    func: grepFiles
  })
}

export const createShellTool = (workspace_id: string) => {
  const isWin = process.platform === "win32"
  const shellName = isWin ? "PowerShell" : "Bash"

  return new BaseFunctionTool({
    name: "shell",
    description: `Execute a shell command in a persistent ${shellName} session. State (env vars, cwd) persists between calls.`,
    schema: z.object({
      command: z.string().meta({ description: "Shell command to execute." }),
      background: z.optional(z.boolean()).meta({ description: "Run the command in background." }),
      timeout: z.optional(z.number()).meta({ description: "Timeout in milliseconds (default: 60000)." })
    }),
    func: async ({ command, background, timeout }: { command: string; background?: boolean; timeout?: number }) => {
      let manager = globalShellManagers.get(workspace_id)
      if (!manager) {
        const workspace = await getWorkspace({ id: workspace_id })
        manager = new ShellManager(workspace.path)
        globalShellManagers.set(workspace_id, manager)
      }

      const sessions = manager.listSessions()
      let session = sessions.find((s) => s.name === "default")
      if (!session) {
        session = manager.createSession("default")
      }

      return session.execute(command, background, timeout)
    }
  })
}

export const createShellSessionTools = (manager: {
  createSession: (name?: string) => { id: string; name: string; cwd: string; isRunning: () => boolean }
  listSessions: () => { id: string; name: string; cwd: string; isRunning: () => boolean }[]
  getSession: (id: string) => {
    execute: (command: string, background?: boolean, timeout?: number) => Promise<string>
    readBuffer: (lines?: number) => string
  }
  killSession: (id: string) => void
}) => {
  const createTerminalTool = new BaseFunctionTool({
    name: "create_terminal",
    description: "Create a persistent terminal session (PowerShell/Bash). Returns a session_id.",
    schema: z.object({
      name: z.optional(z.string()).meta({ description: "Optional name for the session." })
    }),
    func: async ({ name }: { name?: string }) => {
      const session = manager.createSession(name)
      return JSON.stringify({ session_id: session.id, name: session.name, cwd: session.cwd })
    }
  })

  const listTerminalTool = new BaseFunctionTool({
    name: "list_terminals",
    description: "List active terminal sessions.",
    schema: z.object({}),
    func: async () => {
      const sessions = manager.listSessions()
      return (
        sessions
          .map((session) =>
            JSON.stringify({
              session_id: session.id,
              name: session.name,
              cwd: session.cwd,
              status: session.isRunning() ? "running" : "idle"
            })
          )
          .join("\n") || "(no terminal sessions)"
      )
    }
  })

  const execTerminalTool = new BaseFunctionTool({
    name: "exec_terminal",
    description: "Execute a command in a terminal session. CWD and Env persist.",
    schema: z.object({
      session_id: z.string().meta({ description: "Terminal session id." }),
      command: z.string().meta({ description: "Shell command to execute." }),
      background: z.optional(z.boolean()).meta({ description: "Run the command in background." }),
      timeout: z.optional(z.number()).meta({ description: "Timeout in milliseconds (default: 60000)." })
    }),
    func: async ({
      session_id,
      command,
      background,
      timeout
    }: {
      session_id: string
      command: string
      background?: boolean
      timeout?: number
    }) => {
      const session = manager.getSession(session_id)
      return session.execute(command, background, timeout)
    }
  })

  const readTerminalTool = new BaseFunctionTool({
    name: "read_terminal",
    description: "Read recent output from a terminal session.",
    schema: z.object({
      session_id: z.string().meta({ description: "Terminal session id." }),
      lines: z.optional(z.number()).meta({ description: "Number of lines to read." })
    }),
    func: async ({ session_id, lines }: { session_id: string; lines?: number }) => {
      const session = manager.getSession(session_id)
      return session.readBuffer(lines)
    }
  })

  const killTerminalTool = new BaseFunctionTool({
    name: "kill_terminal",
    description: "Stop a terminal session and kill any running process.",
    schema: z.object({
      session_id: z.string().meta({ description: "Terminal session id." })
    }),
    func: async ({ session_id }: { session_id: string }) => {
      manager.killSession(session_id)
      return "Terminal session killed"
    }
  })

  return [createTerminalTool, listTerminalTool, execTerminalTool, readTerminalTool, killTerminalTool]
}

export const createAppendKnowledgeTool = (workspace_id: string) => {
  async function appendKnowledge({
    entry
  }: {
    entry: { id: string; title: string; summary: string; source: string; path: string }
  }) {
    await appendWorkspaceKnowledge({ id: workspace_id, entry })
    return "Knowledge entry appended"
  }

  return new BaseFunctionTool({
    name: "appendKnowledge",
    description: "Append a knowledge index entry to the workspace files.",
    schema: z.object({
      entry: z.object({
        id: z.string(),
        title: z.string(),
        summary: z.string(),
        source: z.string(),
        path: z.string()
      })
    }),
    func: appendKnowledge
  })
}
