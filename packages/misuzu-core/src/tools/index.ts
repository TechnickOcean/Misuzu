import type { AgentTool } from "@mariozechner/pi-agent-core"
import { bashTool, createBashTool } from "./base/bash.js"
import { readTool, createReadTool } from "./base/read.js"
import { writeTool, createWriteTool } from "./base/write.js"
import { editTool, createEditTool } from "./base/edit.js"
import { findTool, createFindTool } from "./base/find.js"
import { grepTool, createGrepTool } from "./base/grep.js"

export {
  type BashOperations,
  type BashToolDetails,
  type BashToolInput,
  bashTool,
  createBashTool,
} from "./base/bash.js"
export {
  type ReadOperations,
  type ReadToolDetails,
  type ReadToolInput,
  readTool,
  createReadTool,
} from "./base/read.js"
export { type WriteOperations, writeTool, createWriteTool } from "./base/write.js"
export {
  type EditOperations,
  type EditToolDetails,
  type EditToolInput,
  editTool,
  createEditTool,
} from "./base/edit.js"
export {
  type FindOperations,
  type FindToolDetails,
  type FindToolInput,
  findTool,
  createFindTool,
} from "./base/find.js"
export { type GrepToolDetails, type GrepToolInput, grepTool, createGrepTool } from "./base/grep.js"
export {
  type TruncationResult,
  truncateHead,
  truncateTail,
  truncateLine,
  formatSize,
} from "./utils/truncate.js"
export { withFileMutationQueue } from "./utils/file-mutation-queue.js"
export { expandPath, resolveToCwd, resolveReadPath } from "./utils/path.js"

/** All base tools for general-purpose agents. Uses process.cwd(). */
export const baseTools: AgentTool<any>[] = [
  readTool,
  bashTool,
  editTool,
  writeTool,
  findTool,
  grepTool,
]

/** Read-only tools for monitoring agents. Uses process.cwd(). */
export const readOnlyTools: AgentTool<any>[] = [readTool, grepTool, findTool]

/** Create base tools scoped to a specific working directory. */
export function createBaseTools(cwd: string): AgentTool<any>[] {
  return [
    createReadTool(cwd),
    createBashTool(cwd),
    createEditTool(cwd),
    createWriteTool(cwd),
    createFindTool(cwd),
    createGrepTool(cwd),
  ]
}

/** Create read-only tools scoped to a specific working directory. */
export function createReadOnlyTools(cwd: string): AgentTool<any>[] {
  return [createReadTool(cwd), createGrepTool(cwd), createFindTool(cwd)]
}
