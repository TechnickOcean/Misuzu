import { join } from "node:path"
import { file } from "bun"
import * as z from "zod"
import BaseFunctionTool from "../base/FunctionTool"
import { createDBWorkspace, getDBWorkspace } from "./core/db"

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

async function editFile({}: {}) {}

export const editFileTool = new BaseFunctionTool()

// export const glob = new BaseFunctionTool()
// export const grep = new BaseFunctionTool()
// export const shell = new BaseFunctionTool()
