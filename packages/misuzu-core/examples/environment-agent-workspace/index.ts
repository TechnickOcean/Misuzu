import "dotenv/config"
import { createInterface } from "node:readline"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { ProxyProviderOptions } from "@/index.ts"
import { createCTFRuntimeWorkspace } from "@/core/application/workspace/index.ts"

const defaultWorkspaceRootDir = dirname(fileURLToPath(import.meta.url))
const workspaceRootDir = resolve(process.argv[2] ?? defaultWorkspaceRootDir)
const workspace = await createCTFRuntimeWorkspace({ rootDir: workspaceRootDir })

workspace.bootstrapProviders()

const model = resolveDefaultModel(workspace.loadProxyProviderOptions(), (provider, modelId) => {
  return workspace.getModel(provider, modelId)
})

if (!model) {
  console.error(
    "No model found from .misuzu/providers.json. Configure at least one provider/model mapping.",
  )
  process.exit(1)
}

const environmentAgent = workspace.createEnvironmentAgent({
  initialState: {
    model,
  },
})

let streamedText = false

environmentAgent.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    streamedText = true
    process.stdout.write(event.assistantMessageEvent.delta)
    return
  }

  if (event.type === "message_end" && event.message.role === "assistant") {
    if (streamedText) {
      process.stdout.write("\n")
      streamedText = false
      return
    }

    for (const content of event.message.content) {
      if (content.type === "text" && content.text.trim()) {
        console.log(content.text)
      }
    }
  }
})

console.log(`Workspace: ${workspace.rootDir}`)
console.log(`Environment base: ${environmentAgent.workspaceBaseDir}`)
console.log(`Model: ${model.provider}/${model.id}`)
console.log("Try: scaffold a plugin for a new platform named acme-ctf")
console.log("Then: deploy_platform_plugin for target .misuzu/platform-plugin")
console.log("Use /compact to compact context, /quit to exit.\n")

const readline = createInterface({ input: process.stdin, output: process.stdout, prompt: "> " })
readline.prompt()

readline.on("line", async (line) => {
  const input = line.trim()

  if (!input) {
    readline.prompt()
    return
  }

  if (input === "/compact") {
    environmentAgent
      .compact()
      .then(() => readline.prompt())
      .catch(() => {})
    return
  }

  if (input === "/quit" || input === "/q") {
    readline.close()
    return
  }

  try {
    await environmentAgent.prompt(input)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Request failed: ${message}`)
  }

  readline.prompt()
})

readline.on("close", async () => {
  await workspace.shutdown()
  console.log("Bye")
  process.exit(0)
})

function resolveDefaultModel<T>(
  optionsList: ProxyProviderOptions[],
  getModel: (provider: string, modelId: string) => T | undefined,
) {
  for (const options of optionsList) {
    const modelIds = extractCandidateModelIds(options)
    for (const modelId of modelIds) {
      const model = getModel(options.provider, modelId)
      if (model) {
        return model
      }
    }
  }

  return undefined
}

function extractCandidateModelIds(options: ProxyProviderOptions) {
  if (options.modelMappings && options.modelMappings.length > 0) {
    return options.modelMappings
      .map((mapping) => {
        if (typeof mapping === "string") {
          return mapping
        }

        return mapping.targetModelId ?? mapping.sourceModelId
      })
      .filter((modelId): modelId is string => Boolean(modelId))
  }

  return options.modelIds ?? []
}
