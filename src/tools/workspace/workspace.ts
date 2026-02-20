import { join } from "node:path"
import { $, file, Glob } from "bun"
import * as z from "zod"
import BaseFunctionTool from "../base/FunctionTool"
import { createDBWorkspace, getDBWorkspace, updateDBWorkspace } from "./core/db"

export const createWorkspaceTool = new BaseFunctionTool({
  name: "createWorkspace",
  description:
    "Create a persistent workspace directory for a task or challenge. Returns a `workspace_id` for use with other tools.",
  schema: z.object({
    title: z.string().meta({ description: "Descriptive title for the workspace." })
  }),
  func: createDBWorkspace
})

async function readFile({
  file_path,
  workspace_id,
  offset,
  limit
}: {
  file_path: string
  workspace_id?: number
  offset?: number
  limit?: number
}) {
  let basePath = ""
  if (workspace_id) basePath = (await getDBWorkspace({ id: workspace_id }))!.path
  const target = file(join(basePath, file_path))
  // if (!(await target.exists())) return "File does not exist!"
  if (target.size >= 20000) {
    return `The file is too large to read (size: ${target.size} bytes), please consider use another way to read it.`
  } else {
    const raw = (await target.text()).split("\n")
    const lines = []
    for (let i = 1; i <= raw.length; i++) lines.push(`${i}| ${raw[i - 1]}`)
    if (offset && limit) {
      return lines.slice(offset, offset + limit).join("\n")
    }
    if (target.size >= 4000) {
      // TODO: use stream
      let sum = 0
      let cnt = 0
      for (const line of lines) {
        sum += line.length
        if (sum >= 4000) break
        cnt += 1
      }
      return `${lines.slice(0, cnt + 1).join("\n")}\n[TOOLTIP] The content is too long (${lines.length} lines in total), add offset and limit to read next contents.`
    } else {
      return lines.join("\n")
    }
  }
}

export const readFileTool = new BaseFunctionTool({
  name: "readFile",
  description: "Read file contents with line numbers. Use `offset` and `limit` for large files.",
  schema: z.object({
    file_path: z.string().meta({ description: "Path to the target file." }),
    workspace_id: z.optional(z.number()),
    offset: z.optional(z.number()).meta({
      description: "Start index (0-based) for reading lines."
    }),
    limit: z.optional(z.number()).meta({ description: "Maximum number of lines to read." })
  }),
  func: readFile
})

async function writeFile({
  file_path,
  content,
  workspace_id
}: {
  file_path: string
  content: string
  workspace_id?: number
}) {
  let basePath = ""
  if (workspace_id) basePath = (await getDBWorkspace({ id: workspace_id }))!.path
  const target = file(join(basePath, file_path))
  if (await target.exists()) return "This file already exists!"
  await target.write(content)
  return "Succesfully wrote!"
}

export const writeFileTool = new BaseFunctionTool({
  name: "writeFile",
  description: "Create a new file with the specified content. Fails if the file already exists.",
  schema: z.object({
    file_path: z.string().meta({ description: "Path to the new file." }),
    content: z.string().meta({ description: "Content to write." }),
    workspace_id: z.optional(z.number())
  }),
  func: writeFile
})

async function editFile({
  file_path,
  old_content,
  new_content,
  workspace_id
}: {
  file_path: string
  old_content: string
  new_content: string
  workspace_id?: number
}) {
  let basePath = ""
  if (workspace_id) basePath = (await getDBWorkspace({ id: workspace_id }))!.path
  const target = file(join(basePath, file_path))
  if (!(await target.exists())) return "File does not exist!"
  const content = await target.text()
  if (!content.includes(old_content)) return "old_content not found!"
  await target.write(content.replace(old_content, new_content))
  return "Successfully edited!"
}

export const editFileTool = new BaseFunctionTool({
  name: "editFile",
  description: "Edit a file by replacing `old_content` with `new_content`.",
  schema: z.object({
    file_path: z.string().meta({ description: "Path to the file to edit." }),
    old_content: z.string().meta({ description: "Unique string in the file to be replaced." }),
    new_content: z.string().meta({ description: "String to replace with." }),
    workspace_id: z.optional(z.number())
  }),
  func: editFile
})

async function globFiles({ pattern, workspace_id }: { pattern: string; workspace_id?: number }) {
  let basePath = "."
  if (workspace_id) basePath = (await getDBWorkspace({ id: workspace_id }))!.path

  const glob = new Glob(pattern)
  const files: string[] = []

  for await (const file of glob.scan({ cwd: basePath, absolute: false })) {
    files.push(file)
  }
  return files.join("\n")
}

export const globTool = new BaseFunctionTool({
  name: "globFiles",
  description: "List files matching a glob pattern.",
  schema: z.object({
    pattern: z.string().meta({ description: "Glob pattern (e.g., `**/*.ts`)." }),
    workspace_id: z.optional(z.number())
  }),
  func: globFiles
})

async function grepFiles({ pattern, workspace_id }: { pattern: string; workspace_id?: number }) {
  let basePath = "."
  if (workspace_id) basePath = (await getDBWorkspace({ id: workspace_id }))!.path

  try {
    const glob = new Glob("**/*")
    const matches: string[] = []

    const regex = new RegExp(pattern)

    for await (const f of glob.scan({ cwd: basePath, absolute: false })) {
      const target = file(join(basePath, f))
      if (target.size > 1024 * 1024) continue
      try {
        const content = await target.text()
        const lines = content.split("\n")
        lines.forEach((line, index) => {
          if (regex.test(line)) {
            matches.push(`${f}:${index + 1}:${line.trim()}`)
          }
        })
      } catch (_e) {}
    }

    return matches.join("\n") || "No matches found."
  } catch (e) {
    return `Error: ${e}`
  }
}

export const grepTool = new BaseFunctionTool({
  name: "grepFiles",
  description: "Search for a string or regex pattern in file contents.",
  schema: z.object({
    pattern: z.string().meta({ description: "String or regex pattern to search for." }),
    workspace_id: z.optional(z.number())
  }),
  func: grepFiles
})

async function shell({ command, workspace_id }: { command: string; workspace_id?: number }) {
  let basePath = "."
  if (workspace_id) basePath = (await getDBWorkspace({ id: workspace_id }))!.path

  try {
    const result = await $`${{ raw: command }}`.cwd(basePath).nothrow().quiet()
    return `STDOUT:\n${result.stdout.toString()}\nSTDERR:\n${result.stderr.toString()}`
  } catch (e) {
    return `Error executing shell command: ${e}`
  }
}

export const shellTool = new BaseFunctionTool({
  name: "shell",
  description: "Execute a shell command. Use with caution.",
  schema: z.object({
    command: z.string().meta({ description: "Shell command to execute." }),
    workspace_id: z.optional(z.number())
  }),
  func: shell
})

async function manageState({
  key,
  value,
  action,
  workspace_id
}: {
  key?: string
  value?: unknown
  action: "get" | "set" | "delete" | "list"
  workspace_id: number
}) {
  const workspace = await getDBWorkspace({ id: workspace_id })
  if (!workspace) throw new Error("Workspace not found")
  const store = (workspace.store as Record<string, unknown>) || {}

  if (action === "get") {
    if (!key) return "Key is required for get action"
    return JSON.stringify(store[key])
  } else if (action === "set") {
    if (!key || value === undefined) return "Key and value are required for set action"
    store[key] = value
    await updateDBWorkspace({ id: workspace_id, data: { store } })
    return "State updated"
  } else if (action === "delete") {
    if (!key) return "Key is required for delete action"
    delete store[key]
    await updateDBWorkspace({ id: workspace_id, data: { store } })
    return "Key deleted"
  } else if (action === "list") {
    return JSON.stringify(store, null, 2)
  }
}

export const stateTool = new BaseFunctionTool({
  name: "manageState",
  description: "Manage a simple key-value store for the workspace.",
  schema: z.object({
    key: z.optional(z.string()).meta({ description: "Key for the state item." }),
    value: z.optional(z.any()).meta({ description: "Value to store (for 'set' action)." }),
    action: z.enum(["get", "set", "delete", "list"]).meta({ description: "Action to perform." }),
    workspace_id: z.number()
  }),
  func: manageState
})
