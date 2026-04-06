import "dotenv/config"
import { createInterface } from "node:readline"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createCTFRuntimeWorkspace } from "@/core/application/workspace/index.ts"

const defaultWorkspaceRootDir = dirname(fileURLToPath(import.meta.url))
const workspaceRootDir = resolve(process.argv[2] ?? defaultWorkspaceRootDir)
const workspace = await createCTFRuntimeWorkspace({
  rootDir: workspaceRootDir,
})

workspace.bootstrapProviders()

const availablePlugins = workspace.listAvailablePlugins()
const configRuntime = await workspace.loadRuntimeOptionsFromPlatformConfig()
const selectedPluginLabel =
  configRuntime?.pluginId ?? "(loaded from persisted snapshot or not initialized)"

console.log(`Workspace: ${workspace.rootDir}`)
console.log(`Platform config: ${workspace.platformConfigPath}`)
console.log(
  `Available plugins: ${availablePlugins.map((entry) => `${entry.id} (${entry.name})`).join(", ") || "(none)"}`,
)
console.log(`Selected plugin: ${selectedPluginLabel}`)
console.log(`Managed challenge count: ${workspace.getManagedChallengeIds().length}`)
console.log("Type /challenges, /sync, /notice, /derive <id|solverId>, /scheduler, /quit")

const readline = createInterface({ input: process.stdin, output: process.stdout, prompt: "> " })
readline.prompt()

readline.on("line", async (line) => {
  const input = line.trim()

  if (!input) {
    readline.prompt()
    return
  }

  try {
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

    if (input.startsWith("/derive ")) {
      const raw = input.slice("/derive ".length).trim()
      if (!raw) {
        console.log("Usage: /derive <challengeId|solverId>")
        readline.prompt()
        return
      }

      const solverId = /^\d+$/.test(raw) ? `solver-${raw}` : raw
      const derivedWorkspace = await workspace.deriveSolverWorkspace(solverId)
      console.log(`Derived workspace: ${derivedWorkspace.rootDir}`)
      console.log(
        `Shared provider registry: ${String(derivedWorkspace.providers === workspace.providers)}`,
      )
      readline.prompt()
      return
    }

    if (input === "/scheduler") {
      console.log(`Scheduler state: ${JSON.stringify(workspace.getSchedulerState(), null, 2)}`)
      readline.prompt()
      return
    }

    if (input === "/quit" || input === "/q") {
      readline.close()
      return
    }

    console.log("Unknown command. Try /challenges, /sync, /notice, /derive, /scheduler, /quit")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Command failed: ${message}`)
  }

  readline.prompt()
})

readline.on("close", async () => {
  await workspace.shutdown()
  console.log("Bye")
  process.exit(0)
})
