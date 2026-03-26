import { constants } from "node:fs"
import {
  readFile as fsReadFile,
  writeFile as fsWriteFile,
  access as fsAccess,
} from "node:fs/promises"
import type { AgentTool } from "@mariozechner/pi-agent-core"
import { type Static, Type } from "@sinclair/typebox"
import { resolveToCwd } from "../utils/path.js"
import { withFileMutationQueue } from "../utils/file-mutation-queue.js"

const editSchema = Type.Object({
  path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
  oldText: Type.String({ description: "Exact text to find and replace (must match exactly)" }),
  newText: Type.String({ description: "New text to replace the old text with" }),
})

export type EditToolInput = Static<typeof editSchema>

export interface EditToolDetails {
  diff: string
  firstChangedLine?: number
}

export interface EditOperations {
  readFile: (absolutePath: string) => Promise<Buffer>
  writeFile: (absolutePath: string, content: string) => Promise<void>
  access: (absolutePath: string) => Promise<void>
}

export interface EditToolOptions {
  operations?: EditOperations
}

export function createEditTool(
  cwd: string,
  options?: EditToolOptions,
): AgentTool<typeof editSchema> {
  const ops = options?.operations ?? defaultEditOperations

  return {
    name: "edit",
    label: "edit",
    description:
      "Replace exact text in a file. oldText must match exactly (whitespace matters). " +
      "Use for surgical edits. Use write for overwriting entire files.",
    parameters: editSchema,
    async execute(_toolCallId, params: EditToolInput) {
      const absolutePath = resolveToCwd(params.path, cwd)

      try {
        await ops.access(absolutePath)
      } catch {
        throw new Error(`File not found: ${params.path}`)
      }

      return withFileMutationQueue(absolutePath, async () => {
        const buffer = await ops.readFile(absolutePath)
        // Strip BOM
        const content = buffer.toString("utf-8").replace(/^\uFEFF/, "")

        const occurrences = content.split(params.oldText).length - 1
        if (occurrences === 0) {
          throw new Error(
            `Could not find the exact text in ${params.path}. The text must match exactly.`,
          )
        }
        if (occurrences > 1) {
          throw new Error(
            `Found ${occurrences} occurrences of the text in ${params.path}. The text must be unique.`,
          )
        }

        const newContent = content.replace(params.oldText, params.newText)
        if (newContent === content) {
          throw new Error("The replacement text is identical to the original.")
        }

        await ops.writeFile(absolutePath, newContent)

        // Compute first changed line
        const beforeEdit = content.slice(0, content.indexOf(params.oldText))
        const firstChangedLine = beforeEdit.split("\n").length

        // Simple diff
        const oldLines = params.oldText.split("\n")
        const newLines = params.newText.split("\n")
        const diffLines: string[] = []
        for (const line of oldLines) diffLines.push(`- ${line}`)
        for (const line of newLines) diffLines.push(`+ ${line}`)

        return {
          content: [{ type: "text", text: `File edited: ${params.path}` }],
          details: { diff: diffLines.join("\n"), firstChangedLine } satisfies EditToolDetails,
        }
      })
    },
  }
}

const defaultEditOperations: EditOperations = {
  readFile: (path) => fsReadFile(path),
  writeFile: (path, content) => fsWriteFile(path, content, "utf-8"),
  access: (path) => fsAccess(path, constants.R_OK | constants.W_OK),
}

export const editTool = createEditTool(process.cwd())
