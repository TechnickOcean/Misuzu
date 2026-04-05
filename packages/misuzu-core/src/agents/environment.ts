import { resolve } from "node:path"
import {
  FeaturedAgent,
  type FeaturedAgentDependencies,
  type FeaturedAgentOptions,
} from "./featured.ts"
import { loadAgentSkills } from "./features/skill.ts"
import { createEnvironmentTools } from "../tools/index.ts"
import { resolveBuiltinPluginWorkspaceDir } from "../plugins/paths.ts"

export interface EnvironmentAgentOptions extends FeaturedAgentOptions {
  workspaceBaseDir?: string
}

const ENVIRONMENT_STANDALONE_PROMPT = [
  'You are the Environment agent of Agents system "Misuzu" for authorized CTF competitions.',
  "Your mission is to adapt CTF platforms into minimal, reliable, protocol-compliant plugins.",
  "Workspace base is the built-in plugin workspace under packages/misuzu-core/plugins.",
  "Standard plugin workflow:",
  "1) Use scaffold_plugin (or pick existing plugin) in the built-in plugin workspace.",
  "2) Follow the plugin-authoring skill methodology to complete implementation details.",
  "3) Register the plugin in plugins/catalog.json, then run vp check and vp test.",
  "After plugin creation, users select pluginId from workspace creation plugin list.",
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

export function resolveDefaultEnvironmentBaseDir() {
  return resolveBuiltinPluginWorkspaceDir()
}

export function createDefaultEnvironmentAgent(
  deps: FeaturedAgentDependencies,
  options: EnvironmentAgentOptions = {},
) {
  return new EnvironmentAgent(deps, {
    ...options,
    workspaceBaseDir: resolveDefaultEnvironmentBaseDir(),
  })
}
