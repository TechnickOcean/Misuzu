import { constants } from "node:fs"
import { readFile as fsReadFile, access as fsAccess } from "node:fs/promises"
import type { AgentTool } from "@mariozechner/pi-agent-core"
import { type Static, Type } from "@sinclair/typebox"
import { truncateHead, type TruncationResult } from "../../utils/truncate.js"
import { resolveReadPath } from "../../utils/path.js"

const readSchema = Type.Object({
  path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
  offset: Type.Optional(
    Type.Number({ description: "Line number to start reading from (1-indexed)" }),
  ),
  limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
})

export type ReadToolInput = Static<typeof readSchema>

export interface ReadToolDetails {
  truncation?: TruncationResult
}

export interface ReadOperations {
  readFile: (absolutePath: string) => Promise<Buffer>
  access: (absolutePath: string) => Promise<void>
}

export interface ReadToolOptions {
  operations?: ReadOperations
}

export function createReadTool(
  cwd: string,
  options?: ReadToolOptions,
): AgentTool<typeof readSchema> {
  const ops = options?.operations ?? defaultReadOperations

  return {
    name: "read",
    label: "read",
    description:
      "Read the contents of a file. Use offset and limit to read specific line ranges. " +
      "Lines are 1-indexed. Use offset=N to skip to line N.",
    parameters: readSchema,
    async execute(_toolCallId, params: ReadToolInput) {
      const absolutePath = await resolveReadPath(params.path, cwd)

      try {
        await ops.access(absolutePath)
      } catch {
        throw new Error(`File not found: ${params.path}`)
      }

      const buffer = await ops.readFile(absolutePath)
      const content = buffer.toString("utf-8")
      const allLines = content.split("\n")

      const offset = params.offset ?? 1
      const startIdx = offset - 1
      const userLimit = params.limit
      const maxLines = userLimit ?? 100

      const sliced = allLines.slice(startIdx, startIdx + maxLines)
      const result = sliced.join("\n")

      const truncation = truncateHead(result)

      let text = truncation.content
      const shownStart = offset
      const shownEnd = offset + sliced.length - 1

      if (sliced.length < allLines.length - startIdx) {
        const nextOffset = shownEnd + 1
        text += `\n\n[Showing lines ${shownStart}-${shownEnd} of ${allLines.length}. Use offset=${nextOffset} to continue.]`
      }

      return {
        content: [{ type: "text", text }],
        details: { truncation },
      }
    },
  }
}

const defaultReadOperations: ReadOperations = {
  readFile: (path) => fsReadFile(path),
  access: (path) => fsAccess(path, constants.R_OK),
}
