import { existsSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { ProxyProvider } from "misuzu-core"

export interface ProviderRegistryPluginContext {
  workspaceRoot: string
  env: NodeJS.ProcessEnv
  ProxyProvider: typeof ProxyProvider
}

export interface ProviderRegistryLoadResult {
  loaded: number
  discovered: number
  errors: string[]
}

type ProviderRegistryPlugin =
  | ((context: ProviderRegistryPluginContext) => Promise<void> | void)
  | undefined

export async function loadProviderRegistryPlugins(
  workspaceRoot: string,
  logger: Pick<Console, "log" | "warn"> = console,
): Promise<ProviderRegistryLoadResult> {
  const providersDir = resolve(workspaceRoot, ".misuzu", "providers")
  if (!existsSync(providersDir)) {
    return { loaded: 0, discovered: 0, errors: [] }
  }

  const files = readdirSync(providersDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /\.(mjs|js|mts|ts)$/i.test(name))
    .sort((a, b) => a.localeCompare(b))

  const result: ProviderRegistryLoadResult = {
    loaded: 0,
    discovered: files.length,
    errors: [],
  }

  for (const file of files) {
    const absolute = resolve(providersDir, file)
    try {
      const imported = await import(pathToFileURL(absolute).href)
      const plugin = resolvePluginExport(imported)
      if (!plugin) {
        result.errors.push(`${file}: missing default export or named export 'register'`)
        continue
      }

      await plugin({
        workspaceRoot,
        env: process.env,
        ProxyProvider,
      })
      result.loaded += 1
      logger.log(`[misuzu-server] provider plugin loaded: ${file}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      result.errors.push(`${file}: ${message}`)
      logger.warn(`[misuzu-server] provider plugin failed: ${file} (${message})`)
    }
  }

  return result
}

function resolvePluginExport(imported: object): ProviderRegistryPlugin {
  const candidate = imported as {
    default?: ProviderRegistryPlugin
    register?: ProviderRegistryPlugin
  }

  if (typeof candidate.default === "function") {
    return candidate.default
  }

  if (typeof candidate.register === "function") {
    return candidate.register
  }

  return undefined
}
