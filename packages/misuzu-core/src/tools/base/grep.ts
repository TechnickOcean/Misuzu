import { readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import type { AgentTool } from "@mariozechner/pi-agent-core"
import { type Static, Type } from "@sinclair/typebox"
import { glob } from "glob"
import { resolveToCwd } from "../../utils/path.js"
import { truncateHead, truncateLine, type TruncationResult } from "../../utils/truncate.js"

const GREP_MAX_LINE_LENGTH = 500

const grepSchema = Type.Object({
  pattern: Type.String({ description: "Search pattern (regex or literal string)" }),
  path: Type.Optional(
    Type.String({ description: "Directory or file to search (default: current directory)" }),
  ),
  glob: Type.Optional(Type.String({ description: "Filter files by glob pattern, e.g. '*.ts'" })),
  ignoreCase: Type.Optional(
    Type.Boolean({ description: "Case-insensitive search (default: false)" }),
  ),
  literal: Type.Optional(
    Type.Boolean({
      description: "Treat pattern as literal string instead of regex (default: false)",
    }),
  ),
  context: Type.Optional(
    Type.Number({
      description: "Number of lines to show before and after each match (default: 0)",
    }),
  ),
  limit: Type.Optional(
    Type.Number({ description: "Maximum number of matches to return (default: 100)" }),
  ),
})

export type GrepToolInput = Static<typeof grepSchema>

export interface GrepToolDetails {
  truncation?: TruncationResult
  matchLimitReached?: number
  linesTruncated?: boolean
}

interface SearchEntry {
  absolutePath: string
  displayPath: string
}

function escapeRegex(source: string) {
  return source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function createSearchRegex(params: GrepToolInput) {
  const source = params.literal ? escapeRegex(params.pattern) : params.pattern
  return new RegExp(source, params.ignoreCase ? "i" : "")
}

async function collectSearchEntries(
  searchPath: string,
  globPattern?: string,
): Promise<SearchEntry[]> {
  const searchPathStat = await stat(searchPath)
  if (searchPathStat.isFile()) {
    return [{ absolutePath: searchPath, displayPath: searchPath }]
  }

  const pattern = globPattern ?? "**/*"
  const relativePaths = await glob(pattern, { cwd: searchPath, nodir: true, maxDepth: 20 })
  return relativePaths.map((relativePath) => ({
    absolutePath: join(searchPath, relativePath),
    displayPath: relativePath,
  }))
}

export function createGrepTool(cwd: string): AgentTool<typeof grepSchema> {
  return {
    name: "grep",
    label: "grep",
    description:
      "Search file contents with regex or literal matching. " +
      "Returns matching lines with file paths and line numbers.",
    parameters: grepSchema,
    async execute(_toolCallId, params: GrepToolInput) {
      const searchPath = params.path ? resolveToCwd(params.path, cwd) : cwd
      const limit = params.limit ?? 100
      const contextLines = Math.max(0, params.context ?? 0)

      let regex: RegExp
      try {
        regex = createSearchRegex(params)
      } catch {
        throw new Error(`Invalid regex pattern: ${params.pattern}`)
      }

      let entries: SearchEntry[]
      try {
        entries = await collectSearchEntries(searchPath, params.glob)
      } catch {
        throw new Error(`Path not found: ${params.path ?? "."}`)
      }

      const outputLines: string[] = []
      let linesTruncated = false
      let matchedLines = 0

      for (const entry of entries) {
        if (matchedLines >= limit) break

        let content: string
        try {
          content = await readFile(entry.absolutePath, "utf-8")
        } catch {
          continue
        }

        const lines = content.split("\n")
        const matchIndexes: number[] = []

        for (let index = 0; index < lines.length; index++) {
          if (matchedLines >= limit) break
          if (!regex.test(lines[index])) continue
          matchedLines += 1
          matchIndexes.push(index)
        }

        if (matchIndexes.length === 0) {
          continue
        }

        const matchLineSet = new Set<number>(matchIndexes)
        const outputIndexSet = new Set<number>()

        for (const matchIndex of matchIndexes) {
          const start = Math.max(0, matchIndex - contextLines)
          const end = Math.min(lines.length - 1, matchIndex + contextLines)
          for (let lineIndex = start; lineIndex <= end; lineIndex++) {
            outputIndexSet.add(lineIndex)
          }
        }

        const outputIndexes = Array.from(outputIndexSet).sort((a, b) => a - b)

        for (const lineIndex of outputIndexes) {
          const separator = matchLineSet.has(lineIndex) ? ":" : "-"
          let output = `${entry.displayPath}${separator}${lineIndex + 1}${separator}${lines[lineIndex]}`
          if (Buffer.byteLength(output, "utf-8") > GREP_MAX_LINE_LENGTH) {
            output = truncateLine(output, GREP_MAX_LINE_LENGTH)
            linesTruncated = true
          }

          outputLines.push(output)
        }
      }

      const output = outputLines.join("\n") || "(no matches)"
      const truncation = truncateHead(output)
      const details: GrepToolDetails = { truncation }

      if (matchedLines >= limit) details.matchLimitReached = limit
      if (linesTruncated) details.linesTruncated = true

      return {
        content: [{ type: "text", text: truncation.content }],
        details,
      }
    },
  }
}
