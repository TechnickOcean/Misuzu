import "dotenv/config"
import { createInterface } from "node:readline"
import { join, resolve } from "node:path"
import { createWorkspace } from "../packages/misuzu-core/src/core/application/workspace/index.ts"
const workspaceRootDir = resolve(process.argv[2] ?? join(process.cwd(), "examples", "workspace"))
const workspace = await createWorkspace({ rootDir: workspaceRootDir })
workspace.bootstrap()
const model = workspace.providers.getModel("rightcode", "gpt-5.2")
let featuredAgent = workspace.mainAgent

if (!featuredAgent)
  featuredAgent = await workspace.createMainAgent({
    kind: "solver",
    initialState: {
      model,
    },
  })

let streamedText = true

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

if (!model) {
  console.log("no models available!")
  process.exit(1)
}

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

  if (input === "/compact") {
    featuredAgent
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
