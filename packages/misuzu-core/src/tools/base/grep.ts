import { readFileSync, statSync } from "node:fs"
import { resolve, join } from "node:path"
import type { AgentTool } from "@mariozechner/pi-agent-core"
import { type Static, Type } from "@sinclair/typebox"
import { globSync } from "glob"
import { truncateHead, truncateLine, type TruncationResult } from "../utils/truncate.js"

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

export function createGrepTool(cwd: string): AgentTool<typeof grepSchema> {
  return {
    name: "grep",
    label: "grep",
    description:
      "Search file contents with regex or literal matching. " +
      "Returns matching lines with file paths and line numbers.",
    parameters: grepSchema,
    async execute(_toolCallId, params: GrepToolInput) {
      const searchPath = params.path ? resolve(cwd, params.path) : cwd
      const limit = params.limit ?? 100

      let regex: RegExp
      try {
        const escaped = params.literal
          ? params.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          : params.pattern
        regex = new RegExp(escaped, params.ignoreCase ? "i" : "")
      } catch {
        throw new Error(`Invalid regex pattern: ${params.pattern}`)
      }

      // Get files to search
      const files: string[] = []
      try {
        const stat = statSync(searchPath)
        if (stat.isFile()) {
          files.push(searchPath)
        } else {
          const pattern = params.glob ?? "**/*"
          files.push(...globSync(pattern, { cwd: searchPath, nodir: true, maxDepth: 20 }))
        }
      } catch {
        throw new Error(`Path not found: ${params.path ?? "."}`)
      }

      const matches: string[] = []
      let linesTruncated = false

      for (const file of files) {
        if (matches.length >= limit) break

        const filePath = searchPath === resolve(cwd, file) ? file : join(searchPath, file)
        let content: string
        try {
          content = readFileSync(filePath, "utf-8")
        } catch {
          continue // Skip unreadable files
        }

        const lines = content.split("\n")
        for (let i = 0; i < lines.length; i++) {
          if (matches.length >= limit) break
          if (regex.test(lines[i])) {
            let line = `${file}:${i + 1}:${lines[i]}`
            if (Buffer.byteLength(line, "utf-8") > GREP_MAX_LINE_LENGTH) {
              line = truncateLine(line, GREP_MAX_LINE_LENGTH)
              linesTruncated = true
            }
            matches.push(line)
          }
        }
      }

      const content = matches.join("\n") || "(no matches)"
      const truncation = truncateHead(content, { maxLines: limit })

      const details: GrepToolDetails = { truncation }
      if (matches.length >= limit) details.matchLimitReached = limit
      if (linesTruncated) details.linesTruncated = true

      return {
        content: [{ type: "text", text: content }],
        details,
      }
    },
  }
}

export const grepTool = createGrepTool(process.cwd())
