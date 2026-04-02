import {
  FeaturedAgent,
  type FeaturedAgentDependencies,
  type FeaturedAgentOptions,
} from "./featured.ts"
import { createBaseTools } from "../tools/index.ts"

const COORDINATOR_PROMPT = [
  "You are a Coordinator agent for CTF challenge orchestration.",
  "Plan solver assignments, respect concurrency and environment limits, and track solver progress.",
].join("\n")

export type CoordinatorAgentOptions = FeaturedAgentOptions

export class CoordinatorAgent extends FeaturedAgent {
  constructor(deps: FeaturedAgentDependencies, options: CoordinatorAgentOptions = {}) {
    const tools = options.tools ?? createBaseTools(deps.cwd)
    const systemPrompt = `${COORDINATOR_PROMPT}\n${options.initialState?.systemPrompt ?? ""}`

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
