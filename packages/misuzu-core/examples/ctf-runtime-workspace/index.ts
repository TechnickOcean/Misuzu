import "dotenv/config"
import { readFileSync } from "node:fs"
import { createInterface } from "node:readline"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  createCTFRuntimeWorkspace,
  type RuntimeInitOptions,
} from "@/core/application/workspace/index.ts"

const defaultWorkspaceRootDir = dirname(fileURLToPath(import.meta.url))
const workspaceRootDir = resolve(process.argv[2] ?? defaultWorkspaceRootDir)
const workspace = await createCTFRuntimeWorkspace({ rootDir: workspaceRootDir })

workspace.bootstrapProviders()

const runtimeConfig = loadRuntimeConfig(workspace.platformConfigPath)
await workspace.initializeRuntime(runtimeConfig)

const availablePlugins = workspace.listAvailablePlugins()
const selectedPluginLabel = runtimeConfig.pluginId ?? "(inline plugin object)"

console.log(`Workspace: ${workspace.rootDir}`)
console.log(`Platform config: ${workspace.platformConfigPath}`)
console.log(
  `Available plugins: ${availablePlugins.map((entry) => `${entry.id} (${entry.name})`).join(", ") || "(none)"}`,
)
console.log(`Selected plugin: ${selectedPluginLabel}`)
console.log(`Managed challenge count: ${workspace.getManagedChallengeIds().length}`)
console.log("Type /challenges, /sync, /notice, /quit")

const readline = createInterface({ input: process.stdin, output: process.stdout, prompt: "> " })
readline.prompt()

readline.on("line", async (line) => {
  const input = line.trim()

  if (!input) {
    readline.prompt()
    return
  }

  if (input === "/challenges") {
    console.log(`Challenge IDs: ${workspace.getManagedChallengeIds().join(", ") || "(empty)"}`)
    readline.prompt()
    return
  }

  if (input === "/sync") {
    await workspace.syncChallengesOnce()
    console.log(`Synced challenges. Total: ${workspace.getManagedChallengeIds().length}`)
    readline.prompt()
    return
  }

  if (input === "/notice") {
    await workspace.syncNoticesOnce()
    console.log("Notice sync completed")
    readline.prompt()
    return
  }

  if (input === "/quit" || input === "/q") {
    readline.close()
    return
  }

  console.log("Unknown command. Try /challenges, /sync, /notice, /quit")
  readline.prompt()
})

readline.on("close", async () => {
  await workspace.shutdown()
  console.log("Bye")
  process.exit(0)
})

function loadRuntimeConfig(path: string) {
  const parsed = JSON.parse(readFileSync(path, "utf-8")) as RuntimeInitOptions
  return resolveEnvPlaceholders(parsed) as RuntimeInitOptions
}

function resolveEnvPlaceholders(value: unknown): unknown {
  if (typeof value === "string" && value.startsWith("$env:")) {
    const envVar = value.slice(5)
    const envValue = process.env[envVar]
    if (!envValue) {
      throw new Error(`Missing environment variable referenced in config: ${envVar}`)
    }
    return envValue
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveEnvPlaceholders(item))
  }

  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value)) {
      output[key] = resolveEnvPlaceholders(nested)
    }
    return output
  }

  return value
}
