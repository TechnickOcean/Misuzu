import { pathToFileURL } from "node:url"
import {
  findBuiltinPlugin,
  loadBuiltinPluginCatalog,
  resolveBuiltinPluginEntryPath,
} from "../../../../../../plugins/catalog.ts"
import type { CTFPlatformPlugin } from "../../../../../../../plugins/index.ts"

export interface ResolveRuntimePluginOptions {
  plugin?: CTFPlatformPlugin
  pluginId?: string
}

export class RuntimePluginLoader {
  async resolve(options: ResolveRuntimePluginOptions): Promise<{
    plugin: CTFPlatformPlugin
    pluginId: string
  }> {
    if (options.plugin) {
      return {
        plugin: options.plugin,
        pluginId: options.pluginId ?? options.plugin.meta.id,
      }
    }

    const plugin = await this.resolveBuiltinPluginOrThrow(options.pluginId)
    return {
      plugin,
      pluginId: options.pluginId!,
    }
  }

  private async resolveBuiltinPluginOrThrow(pluginId: string | undefined) {
    if (!pluginId) {
      throw new Error(
        "Missing pluginId in runtime config. Select a plugin from built-in plugin catalog.",
      )
    }

    const pluginEntry = findBuiltinPlugin(pluginId)
    if (!pluginEntry) {
      const availableIds = loadBuiltinPluginCatalog().map((entry) => entry.id)
      throw new Error(
        `Required plugin is missing from catalog: ${pluginId}. Available plugins: ${availableIds.join(", ") || "none"}`,
      )
    }

    const plugin = await this.loadPluginFromPath(resolveBuiltinPluginEntryPath(pluginEntry))

    if (plugin.meta.id !== pluginId) {
      throw new Error(`Platform plugin id mismatch: expected ${pluginId}, actual ${plugin.meta.id}`)
    }

    return plugin
  }

  private async loadPluginFromPath(modulePath: string) {
    const moduleUrl = pathToFileURL(modulePath).href
    const pluginModule = (await import(moduleUrl)) as Record<string, unknown>

    const createPlugin = this.resolvePluginFactory(pluginModule)
    const plugin = createPlugin()
    const candidate = plugin as Partial<CTFPlatformPlugin> | null

    if (!candidate || typeof candidate !== "object" || typeof candidate.setup !== "function") {
      throw new Error(
        `Invalid platform plugin module. Expected a plugin factory export from ${modulePath}.`,
      )
    }

    return candidate as CTFPlatformPlugin
  }

  private resolvePluginFactory(pluginModule: Record<string, unknown>) {
    // Priority: named factory -> create*Plugin export -> default class/function/object.
    const namedCreatePlugin = pluginModule.createPlugin
    if (typeof namedCreatePlugin === "function") {
      return namedCreatePlugin as () => unknown
    }

    for (const [name, value] of Object.entries(pluginModule)) {
      if (name.startsWith("create") && name.endsWith("Plugin") && typeof value === "function") {
        return value as () => unknown
      }
    }

    const defaultExport = pluginModule.default
    if (typeof defaultExport === "function") {
      return () => {
        try {
          return new (defaultExport as new () => unknown)()
        } catch {
          return (defaultExport as () => unknown)()
        }
      }
    }

    if (defaultExport && typeof defaultExport === "object") {
      return () => defaultExport
    }

    throw new Error("Plugin module has no supported factory export")
  }
}
