import { access, mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { AgentTool } from "@mariozechner/pi-agent-core"
import { type Static, Type } from "@sinclair/typebox"
import {
  resolveBuiltinPluginCatalogPath,
  resolveBuiltinPluginWorkspaceDir,
} from "../../plugins/paths.ts"

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
      const pluginWorkspaceDir = resolvePluginWorkspaceDir(cwd)
      const pluginCatalogPath = resolveBuiltinPluginCatalogPath()
      const pluginDir = join(pluginWorkspaceDir, params.pluginId)
      const overwrite = params.overwrite ?? false

      await mkdir(pluginWorkspaceDir, { recursive: true })
      await mkdir(pluginDir, { recursive: true })

      const indexPath = join(pluginDir, "index.ts")
      const readmePath = join(pluginDir, "README.md")

      await writeIfAllowed(indexPath, buildIndexTemplate(params.pluginId), overwrite)
      await writeIfAllowed(
        readmePath,
        buildReadmeTemplate(params.pluginId, params.displayName),
        overwrite,
      )
      await upsertPluginCatalogEntry(pluginCatalogPath, {
        id: params.pluginId,
        name: params.displayName ?? toDisplayName(params.pluginId),
        entry: `${params.pluginId}/index.ts`,
      })

      return {
        content: [
          {
            type: "text",
            text: `Plugin scaffold ready at ${params.pluginId}/ (catalog updated, overwrite=${String(overwrite)})`,
          },
        ],
        details: {
          pluginWorkspaceDir,
          pluginCatalogPath,
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

function resolvePluginWorkspaceDir(cwd: string) {
  void cwd
  return resolveBuiltinPluginWorkspaceDir()
}

async function upsertPluginCatalogEntry(
  catalogPath: string,
  entry: { id: string; name: string; entry: string },
) {
  const catalog = await loadCatalog(catalogPath)
  const existingIndex = catalog.findIndex((item) => item.id === entry.id)

  if (existingIndex >= 0) {
    catalog[existingIndex] = {
      ...catalog[existingIndex],
      ...entry,
    }
  } else {
    catalog.push(entry)
  }

  await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf-8")
}

async function loadCatalog(catalogPath: string) {
  try {
    const content = await readFile(catalogPath, "utf-8")
    const parsed = JSON.parse(content) as unknown

    if (!Array.isArray(parsed)) {
      throw new Error(`Invalid plugin catalog format: ${catalogPath}`)
    }

    return parsed.map((item) => {
      if (!item || typeof item !== "object") {
        throw new Error(`Invalid plugin catalog entry: ${catalogPath}`)
      }

      const record = item as Record<string, unknown>
      if (typeof record.id !== "string") {
        throw new Error(`Invalid plugin id in catalog: ${catalogPath}`)
      }
      if (typeof record.name !== "string") {
        throw new Error(`Invalid plugin name in catalog: ${catalogPath}`)
      }
      if (typeof record.entry !== "string") {
        throw new Error(`Invalid plugin entry in catalog: ${catalogPath}`)
      }

      return {
        ...record,
        id: record.id,
        name: record.name,
        entry: record.entry,
      }
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return []
    }

    throw error
  }
}

function toDisplayName(pluginId: string) {
  return pluginId
    .split("-")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ")
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
import { openHeadedAuth } from "../utils.ts"

export class ${className}Plugin implements CTFPlatformPlugin {
  readonly meta = {
    id: "${pluginId}",
    name: "${className}",
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

- Keep plugin imports aligned with built-in workspace shared modules: use \`../protocol.ts\` and \`../utils.ts\`.
- Register plugin metadata in \`plugins/catalog.json\` so workspace plugin list can discover it.
- Keep notice polling runtime-only and avoid exposing it directly to solver tools.
`
}
