import "dotenv/config"
import { createInterface } from "node:readline"
import { join, resolve } from "node:path"
import { getModels } from "@mariozechner/pi-ai"
import { createWorkspace } from "./workspace/index.ts"

const workspaceRootDir = resolve(
  process.argv[2] ?? join(process.cwd(), "..", "..", "examples", "workspace"),
)
const workspace = createWorkspace({ rootDir: workspaceRootDir })
const proxyModels = workspace.bootstrap()
const model =
  proxyModels[0] ??
  getModels("openai").find((item) => item.id === "gpt-5.3-codex") ??
  getModels("openai")[0] ??
  getModels("google")[0]

if (!model) {
  throw new Error("No model is available for the demo")
}

const featuredAgent = workspace.createMainAgent({
  initialState: {
    model,
  },
})

let streamedText = false

featuredAgent.subscribe((event) => {
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
console.log("Type your prompt. Use /quit to exit.\n")

const readline = createInterface({ input: process.stdin, output: process.stdout, prompt: "> " })
readline.prompt()

readline.on("line", async (line) => {
  const input = line.trim()

  if (!input) {
    readline.prompt()
    return
  }

  if (input === "/quit" || input === "/q") {
    readline.close()
    return
  }

  try {
    await featuredAgent.prompt(input)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Request failed: ${message}`)
  }

  readline.prompt()
})

readline.on("close", () => {
  console.log("Bye")
  process.exit(0)
})
