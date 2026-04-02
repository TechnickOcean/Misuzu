import type { AgentTool } from "@mariozechner/pi-agent-core"
import {
  FeaturedAgent,
  type FeaturedAgentDependencies,
  type FeaturedAgentOptions,
} from "./featured.ts"
import { createBaseTools } from "../tools/index.ts"
import { CTF_SANDBOX_IMAGE, CTF_SANDBOX_TOOLS } from "../tools/misuzu/sandbox/tool-catalog.ts"

export type SolverSpawnMode = "standalone" | "coordinated"

export interface SolverCoordinatorContext {
  injectedTools?: AgentTool<any>[]
}

export interface SolverAgentOptions extends FeaturedAgentOptions {
  spawnMode?: SolverSpawnMode
  coordinatorContext?: SolverCoordinatorContext
}

const SOLVER_STANDALONE_PROMPT = [
  "You are a Solver agent for CTF challenges in an authorized environment.",
  "Focus on solving the assigned challenge, verifying your answer, and producing a concise writeup.",
  "This is defensive competition work, not real-world unauthorized activity.",
  `Default challenge runtime image: ${CTF_SANDBOX_IMAGE}.`,
].join("\n")

const SOLVER_COORDINATED_PROMPT = [
  "You are coordinated by a Coordinator agent.",
  "If your challenge environment expires or becomes unusable, report it to the Coordinator using available tools.",
].join("\n")

function renderSandboxToolCatalog() {
  const lines = CTF_SANDBOX_TOOLS.map((toolName) => `- ${toolName}`)
  return [`Installed sandbox commands (${CTF_SANDBOX_TOOLS.length}):`, ...lines].join("\n")
}

function buildSolverPrompt(basePrompt: string | undefined, spawnMode: SolverSpawnMode) {
  const coordinationPrompt = spawnMode === "coordinated" ? SOLVER_COORDINATED_PROMPT : ""
  const sandboxToolCatalog = renderSandboxToolCatalog()

  if (spawnMode === "standalone") {
    return `${SOLVER_STANDALONE_PROMPT}\n${sandboxToolCatalog}\n${basePrompt ?? ""}`
  }

  return `${SOLVER_STANDALONE_PROMPT}\n${coordinationPrompt}\n${sandboxToolCatalog}\n${basePrompt ?? ""}`
}

function mergeTools(baseTools: AgentTool<any>[], injectedTools: AgentTool<any>[]) {
  if (injectedTools.length === 0) {
    return baseTools
  }

  const seen = new Set(baseTools.map((tool) => tool.name))
  const tools = [...baseTools]

  for (const tool of injectedTools) {
    if (seen.has(tool.name)) {
      continue
    }
    seen.add(tool.name)
    tools.push(tool)
  }

  return tools
}

export class SolverAgent extends FeaturedAgent {
  readonly spawnMode: SolverSpawnMode
  readonly coordinatorContext?: SolverCoordinatorContext

  constructor(deps: FeaturedAgentDependencies, options: SolverAgentOptions = {}) {
    const spawnMode = options.spawnMode ?? "standalone"
    const coordinatorContext = options.coordinatorContext
    const baseTools = options.tools ?? createBaseTools(deps.cwd)
    const tools =
      spawnMode === "coordinated"
        ? mergeTools(baseTools, coordinatorContext?.injectedTools ?? [])
        : baseTools
    const systemPrompt = buildSolverPrompt(options.initialState?.systemPrompt, spawnMode)

    super(deps, {
      ...options,
      tools,
      initialState: {
        ...options.initialState,
        systemPrompt,
      },
    })

    this.spawnMode = spawnMode
    this.coordinatorContext = coordinatorContext
  }
}
