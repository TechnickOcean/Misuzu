import { stat } from "node:fs/promises"
import type { AgentTool } from "@mariozechner/pi-agent-core"
import { type Static, Type } from "@sinclair/typebox"
import { glob } from "glob"
import { resolveToCwd } from "../../utils/path.js"
import { truncateHead, type TruncationResult } from "../../utils/truncate.js"

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
  stat: (path: string) => Promise<{ isDirectory(): boolean }>
  glob: (pattern: string, cwd: string, options: { limit: number }) => Promise<string[]>
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
    async execute(_toolCallId, params: FindToolInput) {
      const searchPath = params.path ? resolveToCwd(params.path, cwd) : cwd
      const limit = params.limit ?? 1000

      let searchPathStat: { isDirectory(): boolean }
      try {
        searchPathStat = await ops.stat(searchPath)
      } catch {
        throw new Error(`Directory not found: ${params.path ?? "."}`)
      }

      if (!searchPathStat.isDirectory()) {
        throw new Error(`Directory not found: ${params.path ?? "."}`)
      }

      const results = await ops.glob(params.pattern, searchPath, { limit })
      const content = results.join("\n") || "(no matches)"
      const truncation = truncateHead(content, { maxLines: limit })

      const details: FindToolDetails = { truncation }
      if (results.length === limit) details.resultLimitReached = limit

      return {
        content: [{ type: "text", text: truncation.content }],
        details,
      }
    },
  }
}

const defaultFindOperations: FindOperations = {
  stat: (path) => stat(path),
  glob: async (pattern, cwd, { limit }) => {
    const results = await glob(pattern, { cwd, nodir: true, maxDepth: 20 })
    return results.slice(0, limit)
  },
}
