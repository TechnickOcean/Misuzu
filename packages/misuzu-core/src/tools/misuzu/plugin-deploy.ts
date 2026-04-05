import { access, cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import type { AgentTool } from "@mariozechner/pi-agent-core"
import { type Static, Type } from "@sinclair/typebox"
import { resolveWorkspacePlatformPluginDir } from "../../plugins/paths.ts"

const pluginDeploySchema = Type.Object({
  pluginId: Type.String({
    description: "Plugin directory name under built-in plugins workspace",
    pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
  }),
  workspaceDir: Type.Optional(
    Type.String({
      description: "Target workspace root. Defaults to the EnvironmentAgent target workspace",
    }),
  ),
  overwrite: Type.Optional(
    Type.Boolean({ description: "Overwrite existing .misuzu/platform-plugin directory" }),
  ),
})

export type PluginDeployToolInput = Static<typeof pluginDeploySchema>

export function createPluginDeployTool(
  pluginWorkspaceDir: string,
  defaultWorkspaceDir?: string,
): AgentTool<typeof pluginDeploySchema> {
  return {
    name: "deploy_platform_plugin",
    label: "deploy_platform_plugin",
    description: "Copy selected plugin to target workspace .misuzu/platform-plugin.",
    parameters: pluginDeploySchema,
    async execute(_toolCallId, params) {
      const sourcePluginDir = join(pluginWorkspaceDir, params.pluginId)
      if (!(await isDirectory(sourcePluginDir))) {
        throw new Error(`Plugin directory does not exist: ${sourcePluginDir}`)
      }

      const workspaceDir = resolve(params.workspaceDir ?? defaultWorkspaceDir ?? process.cwd())
      const platformPluginDir = resolveWorkspacePlatformPluginDir(workspaceDir)
      const overwrite = params.overwrite ?? true

      if (await exists(platformPluginDir)) {
        if (!overwrite) {
          throw new Error(
            `Platform plugin directory already exists: ${platformPluginDir}. Set overwrite=true to replace it.`,
          )
        }

        await rm(platformPluginDir, { recursive: true, force: true })
      }

      await mkdir(platformPluginDir, { recursive: true })
      await copyDirectoryContents(sourcePluginDir, platformPluginDir)

      await ensureSupportFile(pluginWorkspaceDir, platformPluginDir, "protocol.ts")
      await ensureSupportFile(pluginWorkspaceDir, platformPluginDir, "utils.ts")
      await rewriteLegacyImports(platformPluginDir)

      return {
        content: [
          {
            type: "text",
            text: `Platform plugin deployed to ${platformPluginDir}`,
          },
        ],
        details: {
          pluginId: params.pluginId,
          sourcePluginDir,
          workspaceDir,
          platformPluginDir,
          platformConfigPath: join(workspaceDir, ".misuzu", "platform.json"),
          overwrite,
        },
      }
    },
  }
}

async function copyDirectoryContents(sourceDir: string, targetDir: string) {
  const entries = await readdir(sourceDir, { withFileTypes: true })
  await Promise.all(
    entries.map((entry) => {
      const sourcePath = join(sourceDir, entry.name)
      const targetPath = join(targetDir, entry.name)
      return cp(sourcePath, targetPath, { recursive: true, force: true })
    }),
  )
}

async function ensureSupportFile(pluginWorkspaceDir: string, targetDir: string, fileName: string) {
  const targetPath = join(targetDir, fileName)
  if (await exists(targetPath)) {
    return
  }

  const sourcePath = join(pluginWorkspaceDir, fileName)
  if (!(await exists(sourcePath))) {
    throw new Error(`Required support file is missing: ${sourcePath}`)
  }

  await cp(sourcePath, targetPath, { force: true })
}

async function rewriteLegacyImports(platformPluginDir: string) {
  const files = await collectTypeScriptFiles(platformPluginDir)

  for (const filePath of files) {
    const original = await readFile(filePath, "utf-8")
    const rewritten = original
      .replaceAll('from "../protocol.ts"', 'from "./protocol.ts"')
      .replaceAll("from '../protocol.ts'", "from './protocol.ts'")
      .replaceAll('from "../utils.ts"', 'from "./utils.ts"')
      .replaceAll("from '../utils.ts'", "from './utils.ts'")
      .replaceAll('from "../utils/open-headed-auth.ts"', 'from "./utils.ts"')
      .replaceAll("from '../utils/open-headed-auth.ts'", "from './utils.ts'")

    if (rewritten !== original) {
      await writeFile(filePath, rewritten, "utf-8")
    }
  }
}

async function collectTypeScriptFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectTypeScriptFiles(fullPath)))
      continue
    }

    if (entry.isFile() && fullPath.endsWith(".ts")) {
      files.push(fullPath)
    }
  }

  return files
}

async function exists(path: string) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function isDirectory(path: string) {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}
