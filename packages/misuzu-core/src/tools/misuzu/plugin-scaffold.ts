import { access, mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { AgentTool } from "@mariozechner/pi-agent-core"
import { type Static, Type } from "@sinclair/typebox"
import { resolveBuiltinPluginWorkspaceDir } from "../../plugins/paths.ts"

const pluginScaffoldSchema = Type.Object({
  pluginId: Type.String({
    description: "Kebab-case plugin id, for example: gzctf",
    pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
  }),
  displayName: Type.Optional(Type.String({ description: "Human-readable platform name" })),
  overwrite: Type.Optional(Type.Boolean({ description: "Overwrite existing scaffold files" })),
})

export type PluginScaffoldToolInput = Static<typeof pluginScaffoldSchema>

export function createPluginScaffoldTool(cwd: string): AgentTool<typeof pluginScaffoldSchema> {
  return {
    name: "scaffold_plugin",
    label: "scaffold_plugin",
    description: "Create a protocol-compliant scaffold in built-in plugins workspace.",
    parameters: pluginScaffoldSchema,
    async execute(_toolCallId, params) {
      const pluginWorkspaceDir = await resolvePluginWorkspaceDir(cwd)
      const pluginDir = join(pluginWorkspaceDir, params.pluginId)
      const overwrite = params.overwrite ?? false

      await mkdir(pluginWorkspaceDir, { recursive: true })
      await mkdir(pluginDir, { recursive: true })

      const indexPath = join(pluginDir, "index.ts")
      const protocolPath = join(pluginDir, "protocol.ts")
      const readmePath = join(pluginDir, "README.md")
      const utilsPath = join(pluginDir, "utils.ts")

      const sourceProtocolPath = join(pluginWorkspaceDir, "protocol.ts")
      const sourceUtilsPath = join(pluginWorkspaceDir, "utils.ts")

      await writeIfAllowed(indexPath, buildIndexTemplate(params.pluginId), overwrite)
      await copyIfAllowed(sourceProtocolPath, protocolPath, overwrite)
      await writeIfAllowed(
        readmePath,
        buildReadmeTemplate(params.pluginId, params.displayName),
        overwrite,
      )
      await copyIfAllowed(sourceUtilsPath, utilsPath, overwrite)

      return {
        content: [
          {
            type: "text",
            text: `Plugin scaffold ready at ${params.pluginId}/ (overwrite=${String(overwrite)})`,
          },
        ],
        details: {
          pluginWorkspaceDir,
          pluginDir,
          files: [indexPath, protocolPath, readmePath, utilsPath],
          overwrite,
        },
      }
    },
  }
}

async function writeIfAllowed(path: string, content: string, overwrite: boolean) {
  if (!overwrite && (await exists(path))) {
    const current = await readFile(path, "utf-8")
    if (current.trim().length > 0) {
      return
    }
  }

  await writeFile(path, content, "utf-8")
}

async function copyIfAllowed(sourcePath: string, targetPath: string, overwrite: boolean) {
  if (!(await exists(sourcePath))) {
    throw new Error(`Required plugin support file is missing: ${sourcePath}`)
  }

  if (!overwrite && (await exists(targetPath))) {
    const current = await readFile(targetPath, "utf-8")
    if (current.trim().length > 0) {
      return
    }
  }

  const content = await readFile(sourcePath, "utf-8")
  await writeFile(targetPath, content, "utf-8")
}

async function exists(path: string) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function resolvePluginWorkspaceDir(cwd: string) {
  void cwd
  return resolveBuiltinPluginWorkspaceDir()
}

function buildIndexTemplate(pluginId: string) {
  const className = pluginId
    .split("-")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join("")

  return `import type {
  AuthSession,
  CTFPlatformPlugin,
  ChallengeDetail,
  ChallengeSummary,
  ContestBinding,
  ContestSummary,
  PluginAuthConfig,
  PluginConfig,
  PollResult,
  SubmitResult,
} from "./protocol.ts"
import { openHeadedAuth } from "./utils.ts"

export class ${className}Plugin implements CTFPlatformPlugin {
  readonly meta = {
    id: "${pluginId}",
    name: "${className}",
    match: (_url: string) => false,
  }

  async setup(_config: PluginConfig) {
    throw new Error("Not implemented")
  }

  async login(_auth?: PluginAuthConfig): Promise<AuthSession> {
    if (_auth?.mode === "manual") {
      const result = await openHeadedAuth({
        loginUrl: _auth.loginUrl ?? "https://example.com/account/login",
        authCheckUrl: _auth.authCheckUrl ?? "https://example.com/api/account/profile",
        timeoutSec: _auth.timeoutSec,
      })

      return {
        mode: "cookie",
        cookie: result.cookieHeader,
        refreshable: false,
      }
    }

    throw new Error("Not implemented")
  }

  async refreshAuth(_session: AuthSession): Promise<AuthSession> {
    throw new Error("Not implemented")
  }

  async ensureAuthenticated(): Promise<AuthSession> {
    throw new Error("Not implemented")
  }

  getAuthSession(): AuthSession | null {
    return null
  }

  async listContests(): Promise<ContestSummary[]> {
    throw new Error("Not implemented")
  }

  async bindContest(_binding?: ContestBinding): Promise<ContestSummary> {
    throw new Error("Not implemented")
  }

  async listChallenges(): Promise<ChallengeSummary[]> {
    throw new Error("Not implemented")
  }

  async getChallenge(_challengeId: number): Promise<ChallengeDetail> {
    throw new Error("Not implemented")
  }

  async submitFlagRaw(_challengeId: number, _flag: string): Promise<SubmitResult> {
    throw new Error("Not implemented")
  }

  async pollUpdates(_cursor?: string): Promise<PollResult> {
    throw new Error("Not implemented")
  }
}

export function create${className}Plugin() {
  return new ${className}Plugin()
}
`
}

function buildReadmeTemplate(pluginId: string, displayName?: string) {
  return `# ${pluginId} plugin

Platform: ${displayName ?? pluginId}

## Example config

\`\`\`json
{
  "baseUrl": "https://example.com",
  "contest": { "mode": "auto" },
  "auth": {
    "mode": "cookie",
    "cookie": "<cookie-header>"
  }
}
\`\`\`

## Notes

- Keep plugin imports deployable: use local imports like \`./protocol.ts\` and \`./utils.ts\`.
- After implementation, deploy plugin files to target workspace \`.misuzu/platform-plugin\`.
- Keep notice polling runtime-only and avoid exposing it directly to solver tools.
`
}
