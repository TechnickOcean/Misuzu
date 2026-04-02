import type { AgentTool } from "@mariozechner/pi-agent-core"
import { createBashTool } from "./base/bash.ts"
import { createReadTool } from "./base/read.ts"
import { createWriteTool } from "./base/write.ts"
import { createEditTool } from "./base/edit.ts"
import { createFindTool } from "./base/find.ts"
import { createGrepTool } from "./base/grep.ts"

export {
  type BashOperations,
  type BashToolDetails,
  type BashToolInput,
  buildShellSpawnConfig,
  createBashTool,
} from "./base/bash.ts"
export {
  type ReadOperations,
  type ReadToolDetails,
  type ReadToolInput,
  createReadTool,
} from "./base/read.ts"
export { type WriteOperations, createWriteTool } from "./base/write.ts"
export {
  type EditOperations,
  type EditToolDetails,
  type EditToolInput,
  createEditTool,
} from "./base/edit.ts"
export {
  type FindOperations,
  type FindToolDetails,
  type FindToolInput,
  createFindTool,
} from "./base/find.ts"
export { type GrepToolDetails, type GrepToolInput, createGrepTool } from "./base/grep.ts"

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
