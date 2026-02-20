import { join } from "node:path"
import { file, Glob, spawn } from "bun"
import * as z from "zod"
import BaseFunctionTool from "../base/FunctionTool"
import { createDBWorkspace, getDBWorkspace, updateDBWorkspace } from "./core/db"

export const createWorkspaceTool = new BaseFunctionTool({
  name: "createWorkspace",
  description: `Create a workspace for a certain CTF challenge, 
  where provides a folder in a real machine to store Source Codes, 
  Knowledges, scripts and other middle results during solving the challenge.

  After created a workspace, you can add workspace_id argument to other tools 
  to change the base path of file_path to workspace's base path.`,
  schema: z.object({
    title: z.string().meta({ description: "title of the workspace" })
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
  description: `Read file with line numbers.`,
  schema: z.object({
    file_path: z.string().meta({ description: "the path to taget file" }),
    workspace_id: z.optional(z.number()),
    offset: z.optional(z.number()).meta({
      description:
        "Optional, if the file is too long, you can add limit&offset to read contents of [offset, offset+limit] lines"
    }),
    limit: z.optional(z.number())
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
  description: "create a file and write contents into it",
  schema: z.object({
    file_path: z.string(),
    content: z.string(),
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
  description: "Edit file content by replacing old content with new content.",
  schema: z.object({
    file_path: z.string(),
    old_content: z.string(),
    new_content: z.string(),
    workspace_id: z.optional(z.number())
  }),
  func: editFile
})

async function globFiles({ pattern, workspace_id }: { pattern: string; workspace_id?: number }) {
  let basePath = "."
  if (workspace_id) basePath = (await getDBWorkspace({ id: workspace_id }))!.path

  const glob = new Glob(pattern)
  const files: string[] = []

  // Bun glob scan is async iterable
  for await (const file of glob.scan({ cwd: basePath, absolute: false })) {
    files.push(file)
  }
  return files.join("\n")
}

export const globTool = new BaseFunctionTool({
  name: "globFiles",
  description: "List files matching a glob pattern",
  schema: z.object({
    pattern: z.string(),
    workspace_id: z.optional(z.number())
  }),
  func: globFiles
})

async function grepFiles({ pattern, workspace_id }: { pattern: string; workspace_id?: number }) {
  let basePath = "."
  if (workspace_id) basePath = (await getDBWorkspace({ id: workspace_id }))!.path

  // Use grep command for performance and robustness
  const proc = spawn(["grep", "-rn", pattern, "."], {
    cwd: basePath,
    stdout: "pipe",
    stderr: "pipe"
  })

  const output = await new Response(proc.stdout).text()
  const error = await new Response(proc.stderr).text()

  if (error) return `Error: ${error}`
  return output || "No matches found."
}

export const grepTool = new BaseFunctionTool({
  name: "grepFiles",
  description: "Search for a pattern in files using grep",
  schema: z.object({
    pattern: z.string(),
    workspace_id: z.optional(z.number())
  }),
  func: grepFiles
})

async function shell({ command, workspace_id }: { command: string; workspace_id?: number }) {
  let basePath = "."
  if (workspace_id) basePath = (await getDBWorkspace({ id: workspace_id }))!.path

  // Use sh -c to execute command string
  const proc = spawn(["sh", "-c", command], {
    cwd: basePath,
    stdout: "pipe",
    stderr: "pipe"
  })

  const output = await new Response(proc.stdout).text()
  const error = await new Response(proc.stderr).text()

  return `STDOUT:\n${output}\nSTDERR:\n${error}`
}

export const shellTool = new BaseFunctionTool({
  name: "shell",
  description: "Execute a shell command in the workspace",
  schema: z.object({
    command: z.string(),
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
  description: "Manage persistent state (key-value store) in the workspace",
  schema: z.object({
    key: z.optional(z.string()),
    value: z.optional(z.any()),
    action: z.enum(["get", "set", "delete", "list"]),
    workspace_id: z.number()
  }),
  func: manageState
})
