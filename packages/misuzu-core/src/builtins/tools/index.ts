import type { AgentTool } from "@mariozechner/pi-agent-core";
import { bashTool } from "./base/bash.js";
import { readTool } from "./base/read.js";
import { writeTool } from "./base/write.js";
import { editTool } from "./base/edit.js";
import { findTool } from "./base/find.js";
import { grepTool } from "./base/grep.js";

export {
  type BashOperations,
  type BashToolDetails,
  type BashToolInput,
  bashTool,
  createBashTool,
} from "./base/bash.js";
export {
  type ReadOperations,
  type ReadToolDetails,
  type ReadToolInput,
  readTool,
  createReadTool,
} from "./base/read.js";
export { type WriteOperations, writeTool, createWriteTool } from "./base/write.js";
export {
  type EditOperations,
  type EditToolDetails,
  type EditToolInput,
  editTool,
  createEditTool,
} from "./base/edit.js";
export {
  type FindOperations,
  type FindToolDetails,
  type FindToolInput,
  findTool,
  createFindTool,
} from "./base/find.js";
export { type GrepToolDetails, type GrepToolInput, grepTool, createGrepTool } from "./base/grep.js";
export {
  type TruncationResult,
  truncateHead,
  truncateTail,
  truncateLine,
  formatSize,
} from "./utils/truncate.js";
export { withFileMutationQueue } from "./utils/file-mutation-queue.js";
export { expandPath, resolveToCwd, resolveReadPath } from "./utils/path.js";

/** All base tools for general-purpose agents. Uses process.cwd(). */
export const baseTools: AgentTool<any>[] = [
  readTool,
  bashTool,
  editTool,
  writeTool,
  findTool,
  grepTool,
];

/** Read-only tools for monitoring agents. Uses process.cwd(). */
export const readOnlyTools: AgentTool<any>[] = [readTool, grepTool, findTool];
