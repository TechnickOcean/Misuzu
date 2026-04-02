import {
  FeaturedAgent,
  type FeaturedAgentDependencies,
  type FeaturedAgentOptions,
} from "./featured.ts"
import { createBaseTools } from "../tools/index.ts"
import { CTF_SANDBOX_IMAGE, CTF_SANDBOX_TOOLS } from "../tools/misuzu/sandbox/tool-catalog.ts"

export type SolverAgentOptions = FeaturedAgentOptions

const SOLVER_STANDALONE_PROMPT = [
  'You are a Solver agent of Agents system "Misuzu" for CTF challenges in an authorized environment.',
  "Focus on solving the assigned challenge, verifying your answer, and producing a concise writeup.",
  "This is defensive competition work, not real-world unauthorized activity.",
  `Default challenge runtime image: ${CTF_SANDBOX_IMAGE}.`,
].join("\n")

function renderSandboxToolCatalog() {
  const lines = CTF_SANDBOX_TOOLS.map((toolName) => `- ${toolName}`)
  return [`Installed sandbox commands (${CTF_SANDBOX_TOOLS.length}):`, ...lines].join("\n")
}

function buildSolverPrompt(basePrompt: string | undefined) {
  const sandboxToolCatalog = renderSandboxToolCatalog()

  return `${SOLVER_STANDALONE_PROMPT}\n${sandboxToolCatalog}\n${basePrompt ?? ""}`
}

export class SolverAgent extends FeaturedAgent {
  constructor(deps: FeaturedAgentDependencies, options: SolverAgentOptions = {}) {
    const tools = options.tools ?? createBaseTools(deps.cwd)
    const systemPrompt = buildSolverPrompt(options.initialState?.systemPrompt)

    super(deps, {
      ...options,
      tools,
      initialState: {
        ...options.initialState,
        systemPrompt,
      },
    })
  }
}
