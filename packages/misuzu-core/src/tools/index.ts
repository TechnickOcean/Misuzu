import type { AgentTool } from "@mariozechner/pi-agent-core"
import { createBashTool } from "./base/bash.js"
import { createReadTool } from "./base/read.js"
import { createWriteTool } from "./base/write.js"
import { createEditTool } from "./base/edit.js"
import { createFindTool } from "./base/find.js"
import { createGrepTool } from "./base/grep.js"

export {
  type BashOperations,
  type BashToolDetails,
  type BashToolInput,
  buildShellSpawnConfig,
  createBashTool,
} from "./base/bash.js"
export {
  type ReadOperations,
  type ReadToolDetails,
  type ReadToolInput,
  createReadTool,
} from "./base/read.js"
export { type WriteOperations, createWriteTool } from "./base/write.js"
export {
  type EditOperations,
  type EditToolDetails,
  type EditToolInput,
  createEditTool,
} from "./base/edit.js"
export {
  type FindOperations,
  type FindToolDetails,
  type FindToolInput,
  createFindTool,
} from "./base/find.js"
export { type GrepToolDetails, type GrepToolInput, createGrepTool } from "./base/grep.js"

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

export function createReadOnlyTools(cwd: string): AgentTool<any>[] {
  return [createReadTool(cwd), createGrepTool(cwd), createFindTool(cwd)]
}
