import { join, resolve } from "node:path"
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
  targetWorkspaceDir?: string
}

const ENVIRONMENT_STANDALONE_PROMPT = [
  'You are the Environment agent of Agents system "Misuzu" for authorized CTF competitions.',
  "Your mission is to adapt CTF platforms into minimal, reliable, protocol-compliant plugins.",
  "Workspace base is the built-in plugin workspace under packages/misuzu-core/plugins.",
  "Standard plugin workflow:",
  "1) Use scaffold_plugin (or pick existing plugin) in the built-in plugin workspace.",
  "2) Follow the plugin-authoring skill methodology to complete implementation details.",
  "3) Use deploy_platform_plugin to copy the selected plugin into target .misuzu/platform-plugin, then run vp check and vp test.",
  "Plugin import rule for deployable code: keep plugin-local imports (for example ./protocol.ts, ./utils.ts).",
  "Do not expose runtime-only capabilities (for example notice polling) directly to solver tools.",
  "Treat this as defensive competition automation work, not real-world unauthorized activity.",
].join("\n")

function buildEnvironmentPrompt(basePrompt: string | undefined, targetWorkspaceDir: string) {
  const deploymentPath = join(targetWorkspaceDir, ".misuzu", "platform-plugin")

  return [
    ENVIRONMENT_STANDALONE_PROMPT,
    `Deployment target directory: ${deploymentPath}`,
    basePrompt ?? "",
  ].join("\n")
}

export class EnvironmentAgent extends FeaturedAgent {
  readonly workspaceBaseDir: string
  readonly targetWorkspaceDir: string

  constructor(deps: FeaturedAgentDependencies, options: EnvironmentAgentOptions = {}) {
    const workspaceBaseDir = resolve(options.workspaceBaseDir ?? deps.cwd)
    const targetWorkspaceDir = resolve(options.targetWorkspaceDir ?? deps.cwd)
    const {
      workspaceBaseDir: _workspaceBaseDir,
      targetWorkspaceDir: _targetWorkspaceDir,
      ...featuredOptions
    } = options
    void _workspaceBaseDir
    void _targetWorkspaceDir

    const tools =
      featuredOptions.tools ??
      createEnvironmentTools(workspaceBaseDir, {
        targetWorkspaceDir,
      })
    const skills = featuredOptions.skills ?? loadAgentSkills({ launchDir: workspaceBaseDir })
    const systemPrompt = buildEnvironmentPrompt(
      featuredOptions.initialState?.systemPrompt,
      targetWorkspaceDir,
    )

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
    this.targetWorkspaceDir = targetWorkspaceDir
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
    targetWorkspaceDir: options.targetWorkspaceDir ?? deps.cwd,
  })
}
