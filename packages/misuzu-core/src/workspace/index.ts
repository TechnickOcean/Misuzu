import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { type Api, type Model } from "@mariozechner/pi-ai"
import { ProviderRegistry, type ProxyProviderOptions } from "../providers/index.ts"

const WORKSPACE_MARKER_DIR = ".misuzu"
const WORKSPACE_PROVIDER_CONFIG_FILE = "providers.json"
const WORKSPACE_SKILLS_DIR = "skills"
const workspaceRegistry = new Map<string, Workspace>()

export class Workspace {
  readonly rootDir: string
  readonly markerDir: string
  readonly skillsRootDir: string
  readonly providerConfigPath: string
  readonly providers = new ProviderRegistry()

  private proxyProvidersLoaded = false

  constructor(rootDir: string) {
    this.rootDir = resolve(rootDir)
    this.markerDir = join(this.rootDir, WORKSPACE_MARKER_DIR)
    this.skillsRootDir = this.resolveMarkerPath(WORKSPACE_SKILLS_DIR)
    this.providerConfigPath = this.resolveMarkerPath(WORKSPACE_PROVIDER_CONFIG_FILE)
  }

  resolveMarkerPath(...paths: string[]) {
    return join(this.markerDir, ...paths)
  }

  loadProxyProviderOptions() {
    if (!existsSync(this.providerConfigPath)) {
      return []
    }

    return JSON.parse(readFileSync(this.providerConfigPath, "utf-8")) as ProxyProviderOptions[]
  }

  registerProxyProviders() {
    return this.providers.registerProxyProviders(this.loadProxyProviderOptions())
  }

  registerProxyProvidersOnce() {
    if (this.proxyProvidersLoaded) {
      return []
    }

    const registeredModels = this.registerProxyProviders()
    this.proxyProvidersLoaded = true
    return registeredModels
  }

  getModel(provider: string, modelId: string): Model<Api> | undefined {
    return this.providers.getModel(provider, modelId)
  }
}

export function getWorkspace(rootDir = process.cwd()) {
  const resolvedRootDir = resolve(rootDir)
  const cachedWorkspace = workspaceRegistry.get(resolvedRootDir)
  if (cachedWorkspace) {
    return cachedWorkspace
  }

  const workspace = new Workspace(resolvedRootDir)
  workspaceRegistry.set(resolvedRootDir, workspace)
  return workspace
}
