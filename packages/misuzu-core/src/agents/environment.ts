import { resolve } from "node:path"
import {
  FeaturedAgent,
  type FeaturedAgentDependencies,
  type FeaturedAgentOptions,
} from "./featured.ts"
import { loadAgentSkills } from "./features/skill.ts"
import { createEnvironmentTools } from "../tools/index.ts"

export interface EnvironmentAgentOptions extends FeaturedAgentOptions {
  workspaceBaseDir?: string
}

const ENVIRONMENT_STANDALONE_PROMPT = [
  'You are the Environment agent of Agents system "Misuzu" for authorized CTF competitions.',
  "Your mission is to adapt CTF platforms into plugins and keep plugin implementations minimal, reliable, and easy to maintain.",
  "Focus on extracting stable platform APIs, implementing protocol-compliant adapters, and documenting assumptions and limits.",
  "Workspace base is the plugins directory. Prefer editing files under plugins/ and reading skills under plugins/.misuzu/skills/.",
  "For interactive auth, implement plugin-side login using shared helper imports under plugins/utils/.",
  "Do not expose runtime-only capabilities (for example notice polling) directly to solver tools.",
  "Treat this as defensive competition automation work, not real-world unauthorized activity.",
].join("\n")

function buildEnvironmentPrompt(basePrompt: string | undefined) {
  return `${ENVIRONMENT_STANDALONE_PROMPT}\n${basePrompt ?? ""}`
}

export class EnvironmentAgent extends FeaturedAgent {
  readonly workspaceBaseDir: string

  constructor(deps: FeaturedAgentDependencies, options: EnvironmentAgentOptions = {}) {
    const workspaceBaseDir = resolve(options.workspaceBaseDir ?? deps.cwd)
    const { workspaceBaseDir: _workspaceBaseDir, ...featuredOptions } = options
    void _workspaceBaseDir

    const tools = featuredOptions.tools ?? createEnvironmentTools(workspaceBaseDir)
    const skills = featuredOptions.skills ?? loadAgentSkills({ launchDir: workspaceBaseDir })
    const systemPrompt = buildEnvironmentPrompt(featuredOptions.initialState?.systemPrompt)

    super(
      {
        ...deps,
        cwd: workspaceBaseDir,
      },
      {
        ...featuredOptions,
        tools,
        skills,
        initialState: {
          ...featuredOptions.initialState,
          systemPrompt,
        },
      },
    )

    this.workspaceBaseDir = workspaceBaseDir
  }
}
