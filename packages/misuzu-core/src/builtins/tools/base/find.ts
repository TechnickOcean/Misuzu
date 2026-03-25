import { statSync } from "node:fs"
import { resolve } from "node:path"
import type { AgentTool } from "@mariozechner/pi-agent-core"
import { type Static, Type } from "@sinclair/typebox"
import { globSync } from "glob"
import { truncateHead, type TruncationResult } from "../utils/truncate.js"

const findSchema = Type.Object({
  pattern: Type.String({ description: "Glob pattern to match files, e.g. '*.ts', '**/*.json'" }),
  path: Type.Optional(
    Type.String({ description: "Directory to search in (default: current directory)" }),
  ),
  limit: Type.Optional(Type.Number({ description: "Maximum number of results (default: 1000)" })),
})

export type FindToolInput = Static<typeof findSchema>

export interface FindToolDetails {
  truncation?: TruncationResult
  resultLimitReached?: number
}

export interface FindOperations {
  exists: (path: string) => boolean
  glob: (pattern: string, cwd: string, options: { limit: number }) => string[]
}

export interface FindToolOptions {
  operations?: FindOperations
}

export function createFindTool(
  cwd: string,
  options?: FindToolOptions,
): AgentTool<typeof findSchema> {
  const ops = options?.operations ?? defaultFindOperations

  return {
    name: "find",
    label: "find",
    description:
      "Search for files matching a glob pattern. " +
      "Examples: '*.py', 'src/**/*.ts', '**/Dockerfile'.",
    parameters: findSchema,
    async execute(toolCallId, params: FindToolInput) {
      const searchPath = params.path ? resolve(cwd, params.path) : cwd
      const limit = params.limit ?? 1000

      if (!ops.exists(searchPath)) {
        throw new Error(`Directory not found: ${params.path ?? "."}`)
      }

      const results = ops.glob(params.pattern, searchPath, { limit })
      const content = results.join("\n") || "(no matches)"
      const truncation = truncateHead(content, { maxLines: limit })

      const details: FindToolDetails = { truncation }
      if (results.length >= limit) details.resultLimitReached = limit

      return {
        content: [{ type: "text", text: content }],
        details,
      }
    },
  }
}

const defaultFindOperations: FindOperations = {
  exists: (path) => {
    try {
      return statSync(path).isDirectory()
    } catch {
      return false
    }
  },
  glob: (pattern, cwd, { limit }) => {
    return globSync(pattern, { cwd, nodir: true, maxDepth: 20 }).slice(0, limit)
  },
}

export const findTool = createFindTool(process.cwd())
