import { join } from "node:path"
import * as Bun from "bun"
import { file, Glob } from "bun"
import * as z from "zod"
import { AppError } from "@/utils/errors"
import BaseFunctionTool from "../base/FunctionTool"
import { createDBWorkspace, getDBWorkspace, updateDBWorkspace } from "./core/db"

const MAX_OUTPUT_CHARS = 2000

export const createWorkspaceTool = new BaseFunctionTool({
  name: "createWorkspace",
  description:
    "Create a persistent workspace directory for a task or challenge. Returns a `workspace_id` for use with other tools.",
  schema: z.object({
    title: z.string().meta({ description: "Descriptive title for the workspace." })
  }),
  func: createDBWorkspace
})

export const createReadFileTool = (workspace_id: number) => {
  async function readFile({ file_path, offset, limit }: { file_path: string; offset?: number; limit?: number }) {
    const basePath = (await getDBWorkspace({ id: workspace_id }))!.path
    const target = file(join(basePath, file_path))
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

export const createWriteFileTool = (workspace_id: number) => {
  async function writeFile({ file_path, content }: { file_path: string; content: string }) {
    const basePath = (await getDBWorkspace({ id: workspace_id }))!.path
    const target = file(join(basePath, file_path))
    if (await target.exists()) {
      throw new AppError("CONFLICT", "File already exists", { file_path })
    }
    await target.write(content)
    return "Succesfully wrote!"
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

export const createEditFileTool = (workspace_id: number) => {
  async function editFile({
    file_path,
    old_content,
    new_content
  }: {
    file_path: string
    old_content: string
    new_content: string
  }) {
    const basePath = (await getDBWorkspace({ id: workspace_id }))!.path
    const target = file(join(basePath, file_path))
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

export const createGlobTool = (workspace_id: number) => {
  async function globFiles({ pattern }: { pattern: string }) {
    const basePath = (await getDBWorkspace({ id: workspace_id }))!.path

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

export const createGrepTool = (workspace_id: number) => {
  async function grepFiles({ pattern }: { pattern: string }) {
    const basePath = (await getDBWorkspace({ id: workspace_id }))!.path

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

export const createShellTool = (workspace_id: number) => {
  async function shell({ command }: { command: string }) {
    const basePath = (await getDBWorkspace({ id: workspace_id }))!.path

    const subprocess = Bun.spawn({
      cmd: buildShellCommand(command),
      cwd: basePath,
      env: { ...process.env },
      stdout: "pipe",
      stderr: "pipe"
    })

    const [stdout, stderr, exitCode] = await Promise.all([
      subprocess.stdout ? new Response(subprocess.stdout).text() : Promise.resolve(""),
      subprocess.stderr ? new Response(subprocess.stderr).text() : Promise.resolve(""),
      subprocess.exited
    ])

    if (exitCode !== 0) {
      throw new AppError("UPSTREAM_ERROR", "Shell command failed", {
        command,
        exitCode
      })
    }

    return formatOutput(stdout, stderr)
  }

  return new BaseFunctionTool({
    name: "shell",
    description: "Execute a shell command. Use with caution.",
    schema: z.object({
      command: z.string().meta({ description: "Shell command to execute." })
    }),
    func: shell
  })
}

function buildShellCommand(command: string) {
  if (process.platform === "win32") return ["cmd.exe", "/c", command]
  return ["bash", "-lc", command]
}

function formatOutput(stdout: string, stderr: string) {
  let out = stdout
  let err = stderr
  if (out.length > MAX_OUTPUT_CHARS) {
    out = `${out.slice(0, MAX_OUTPUT_CHARS)}\n... (stdout truncated)`
  }
  if (err.length > MAX_OUTPUT_CHARS) {
    err = `${err.slice(0, MAX_OUTPUT_CHARS)}\n... (stderr truncated)`
  }
  return `STDOUT:\n${out}\nSTDERR:\n${err}`
}

export const createShellSessionTools = (manager: {
  createSession: (name?: string) => { id: string; name: string; cwd: string; isRunning: () => boolean }
  listSessions: () => { id: string; name: string; cwd: string; isRunning: () => boolean }[]
  getSession: (id: string) => {
    execute: (command: string, background?: boolean) => Promise<string>
    readBuffer: (lines?: number) => string
  }
  killSession: (id: string) => void
}) => {
  const createTerminalTool = new BaseFunctionTool({
    name: "create_terminal",
    description: "Create a persistent terminal session. Returns a session_id.",
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
    description: "Execute a command in a terminal session.",
    schema: z.object({
      session_id: z.string().meta({ description: "Terminal session id." }),
      command: z.string().meta({ description: "Shell command to execute." }),
      background: z.optional(z.boolean()).meta({ description: "Run the command in background." })
    }),
    func: async ({
      session_id,
      command,
      background
    }: {
      session_id: string
      command: string
      background?: boolean
    }) => {
      const session = manager.getSession(session_id)
      return session.execute(command, background)
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

export const createStateTool = (workspace_id: number) => {
  async function manageState({
    key,
    value,
    action
  }: {
    key?: string
    value?: unknown
    action: "get" | "set" | "delete" | "list"
  }) {
    const workspace = await getDBWorkspace({ id: workspace_id })
    if (!workspace) throw new AppError("NOT_FOUND", "Workspace not found", { workspace_id })
    const store = (workspace.store as Record<string, unknown>) || {}

    if (action === "get") {
      if (!key) throw new AppError("VALIDATION_ERROR", "Key is required for get action")
      const payload = JSON.stringify(store[key])
      if (payload.length > MAX_OUTPUT_CHARS) {
        return `${payload.slice(0, MAX_OUTPUT_CHARS)}\n... (value truncated)`
      }
      return payload
    }
    if (action === "set") {
      if (!key || value === undefined)
        throw new AppError("VALIDATION_ERROR", "Key and value are required for set action")
      store[key] = value
      await updateDBWorkspace({ id: workspace_id, data: { store } })
      return "State updated"
    }
    if (action === "delete") {
      if (!key) throw new AppError("VALIDATION_ERROR", "Key is required for delete action")
      delete store[key]
      await updateDBWorkspace({ id: workspace_id, data: { store } })
      return "Key deleted"
    }
    if (action === "list") {
      const payload = JSON.stringify(store, null, 2)
      if (payload.length > MAX_OUTPUT_CHARS) {
        return `${payload.slice(0, MAX_OUTPUT_CHARS)}\n... (list truncated)`
      }
      return payload
    }
    throw new AppError("VALIDATION_ERROR", "Unknown action", { action })
  }

  return new BaseFunctionTool({
    name: "manageState",
    description: "Manage a simple key-value store for the workspace.",
    schema: z.object({
      key: z.optional(z.string()).meta({ description: "Key for the state item." }),
      value: z.optional(z.any()).meta({ description: "Value to store (for 'set' action)." }),
      action: z.enum(["get", "set", "delete", "list"]).meta({ description: "Action to perform." })
    }),
    func: manageState
  })
}

export const createAppendKnowledgeTool = (workspace_id: number) => {
  async function appendKnowledge({
    entry
  }: {
    entry: { id: string; title: string; summary: string; source: string; path: string }
  }) {
    const workspace = await getDBWorkspace({ id: workspace_id })
    if (!workspace) throw new AppError("NOT_FOUND", "Workspace not found", { workspace_id })
    const store = (workspace.store as Record<string, unknown>) || {}
    const knowledge = Array.isArray(store.knowledge_index) ? store.knowledge_index : []
    const next = {
      ...store,
      knowledge_index: [...knowledge, entry]
    }
    await updateDBWorkspace({ id: workspace_id, data: { store: next } })
    return "Knowledge entry appended"
  }

  return new BaseFunctionTool({
    name: "appendKnowledge",
    description: "Append a knowledge index entry to the workspace store.",
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
