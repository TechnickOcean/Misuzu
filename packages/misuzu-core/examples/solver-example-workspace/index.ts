import "dotenv/config"
import { createInterface } from "node:readline"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createSolverWorkspace } from "@/core/application/workspace/index.ts"

const defaultWorkspaceRootDir = dirname(fileURLToPath(import.meta.url))
const workspaceRootDir = resolve(process.argv[2] ?? defaultWorkspaceRootDir)
const workspace = await createSolverWorkspace({ rootDir: workspaceRootDir })
workspace.bootstrap()

const model = workspace.getModel("swpumc", "gpt-5.3-codex")

if (!model) {
  console.error(
    "No model found from .misuzu/providers.json. Configure at least one provider/model mapping.",
  )
  process.exit(1)
}

let mainAgent = workspace.mainAgent

if (!mainAgent)
  mainAgent = await workspace.createMainAgent({
    initialState: {
      model,
    },
  })

let streamedText = true

mainAgent.subscribe((event) => {
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
console.log(`Model: ${model.provider}/${model.id}`)
console.log("Type your prompt. Use /compact to compact context, /quit to exit.\n")

const readline = createInterface({ input: process.stdin, output: process.stdout, prompt: "> " })
readline.prompt()

readline.on("line", async (line) => {
  const input = line.trim()

  if (!input) {
    readline.prompt()
    return
  }

  if (input === "/compact") {
    mainAgent
      .compact()
      .then((_e) => readline.prompt())
      .catch(() => {})
    return
  }

  if (input === "/quit" || input === "/q") {
    readline.close()
    return
  }

  try {
    await mainAgent.prompt(input)
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
