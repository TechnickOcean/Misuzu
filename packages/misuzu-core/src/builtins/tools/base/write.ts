import { mkdir, writeFile as fsWriteFile } from "node:fs/promises"
import { dirname } from "node:path"
import type { AgentTool } from "@mariozechner/pi-agent-core"
import { Type } from "@sinclair/typebox"
import { resolveToCwd } from "../utils/path.js"
import { withFileMutationQueue } from "../utils/file-mutation-queue.js"

const writeSchema = Type.Object({
  path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
  content: Type.String({ description: "Content to write to the file" }),
})

export interface WriteOperations {
  writeFile: (absolutePath: string, content: string) => Promise<void>
  mkdir: (dir: string) => Promise<void>
}

export interface WriteToolOptions {
  operations?: WriteOperations
}

export function createWriteTool(
  cwd: string,
  options?: WriteToolOptions,
): AgentTool<typeof writeSchema> {
  const ops = options?.operations ?? defaultWriteOperations

  return {
    name: "write",
    label: "write",
    description:
      "Write content to a file, creating parent directories if needed. " +
      "Overwrites the file if it exists. Use edit for surgical changes to existing files.",
    parameters: writeSchema,
    execute: async (_toolCallId, params, _signal, _onUpdate) => {
      const absolutePath = resolveToCwd(params.path, cwd)

      await withFileMutationQueue(absolutePath, async () => {
        await ops.mkdir(dirname(absolutePath))
        await ops.writeFile(absolutePath, params.content)
      })

      return {
        content: [{ type: "text" as const, text: `File written: ${params.path}` }],
        details: undefined,
      }
    },
  }
}

const defaultWriteOperations: WriteOperations = {
  writeFile: (path, content) => fsWriteFile(path, content, "utf-8"),
  mkdir: (dir) => mkdir(dir, { recursive: true }).then(() => {}),
}

export const writeTool = createWriteTool(process.cwd())
