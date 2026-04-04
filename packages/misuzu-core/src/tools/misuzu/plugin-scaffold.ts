import { access, mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { AgentTool } from "@mariozechner/pi-agent-core"
import { type Static, Type } from "@sinclair/typebox"

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
    description: "Create a protocol-compliant plugin scaffold under current plugins workspace.",
    parameters: pluginScaffoldSchema,
    async execute(_toolCallId, params) {
      const pluginDir = join(cwd, params.pluginId)
      const overwrite = params.overwrite ?? false

      await mkdir(pluginDir, { recursive: true })

      const indexPath = join(pluginDir, "index.ts")
      const readmePath = join(pluginDir, "README.md")

      await writeIfAllowed(indexPath, buildIndexTemplate(params.pluginId), overwrite)
      await writeIfAllowed(
        readmePath,
        buildReadmeTemplate(params.pluginId, params.displayName),
        overwrite,
      )

      return {
        content: [
          {
            type: "text",
            text: `Plugin scaffold ready at ${params.pluginId}/ (overwrite=${String(overwrite)})`,
          },
        ],
        details: {
          pluginDir,
          files: [indexPath, readmePath],
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

async function exists(path: string) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
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
} from "../protocol.ts"
import { openHeadedAuth } from "../utils/open-headed-auth.ts"

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

- Implement protocol methods from \`plugins/protocol.ts\`.
- Keep notice polling runtime-only and avoid exposing it directly to solver tools.
`
}
