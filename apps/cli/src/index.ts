#!/usr/bin/env tsx
import { createInterface } from "node:readline"
import { type KnownProvider, getModels } from "@mariozechner/pi-ai"
import type { Model } from "@mariozechner/pi-ai"
import { Coordinator, ProxyProvider } from "misuzu-core"
import "dotenv/config"

const rightCodeProvider = new ProxyProvider({
  provider: "rightcode",
  baseProvider: "openai",
  baseUrl: "https://www.right.codes/codex/v1",
  apiKeyEnvVar: "RIGHTCODE_API_KEY",
  modelMappings: [
    "gpt-5.4",
    "gpt-5.3-codex",
    {
      sourceModelId: "gpt-5.2",
      targetModelId: "gpt-5.2-xhigh",
      targetModelName: "GPT-5.2 XHigh",
    },
  ],
})
rightCodeProvider.register()

const args = process.argv.slice(2)
const rawModel = args[0] ?? "rightcode/gpt-5.4"
const [provider, ...modelParts] = rawModel.split("/")
const modelId = modelParts.join("/")
const typedProvider = provider as KnownProvider
const defaultThinkingLevel = rawModel === "rightcode/gpt-5.2-xhigh" ? "xhigh" : "medium"

function loadModel(): Model<any> {
  const models = getModels(typedProvider)
  const found = models.find((m) => m.id === modelId)
  if (found) return found
  console.error(`Unknown model: ${rawModel}`)
  console.error(`Available: ${models.map((m) => m.id).join(", ")}`)
  process.exit(1)
}

console.log(`misuzu-cli — model: ${rawModel}`)
console.log("Type a prompt to chat. Commands: /history, /clear, /info, /solvers, /quit\n")

let coordinator = createCoordinator()

// Streaming state
let streamingActive = false
let thinkingActive = false

function createCoordinator(): Coordinator {
  const c = new Coordinator({
    model: loadModel(),
    cwd: process.cwd(),
    workspaceRoot: process.cwd(),
  })
  c.state.thinkingLevel = defaultThinkingLevel
  watchAgent(c)
  return c
}

function showThinking() {
  if (!thinkingActive) {
    thinkingActive = true
    process.stdout.write("\x1b[90m  thinking...\x1b[0m")
  }
}

function clearThinking() {
  if (thinkingActive) {
    thinkingActive = false
    process.stdout.write("\r\x1b[K")
  }
}

function watchAgent(c: Coordinator) {
  c.subscribe((event) => {
    switch (event.type) {
      case "turn_start":
        showThinking()
        break

      case "tool_execution_start":
        clearThinking()
        printGray(`  ⚙ ${event.toolName}(${truncate(JSON.stringify(event.args), 120)})`)
        showThinking()
        break

      case "tool_execution_end":
        clearThinking()
        if (event.isError) {
          const result = event.result as { content?: { type: string; text: string }[] }
          const text = result.content?.[0]?.text ?? JSON.stringify(result)
          printRed(`  ✗ ${event.toolName} failed: ${truncate(text, 200)}`)
        } else {
          printGray(`  ✓ ${event.toolName} done`)
        }
        break

      case "message_update": {
        const ae = event.assistantMessageEvent
        if (ae.type === "text_delta") {
          clearThinking()
          streamingActive = true
          process.stdout.write(ae.delta)
        }
        break
      }

      case "message_end": {
        const msg = event.message
        if (msg.role === "assistant") {
          clearThinking()
          // If no streaming happened (no text_delta events), print full text now
          if (!streamingActive) {
            for (const c of msg.content) {
              if (c.type === "text" && c.text.trim()) {
                console.log(c.text)
              }
            }
          } else {
            // Streaming already showed text, just add newline if needed
            streamingActive = false
            process.stdout.write("\n")
          }
        }
        if (msg.role === "flagResult") {
          printGreen(`  🚩 Flag: ${(msg as any).flag}`)
        }
        break
      }

      case "agent_end":
        clearThinking()
        break
    }
  })
}

const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "> " })
rl.prompt()

rl.on("line", async (line) => {
  const input = line.trim()
  if (!input) {
    rl.prompt()
    return
  }

  if (input.startsWith("/")) {
    handleCommand(input)
    rl.prompt()
    return
  }
  await coordinator.prompt(input)
  rl.prompt()
})

rl.on("close", () => {
  console.log("\nBye!")
  process.exit(0)
})

function handleCommand(input: string) {
  const cmd = input.toLowerCase()
  if (cmd === "/quit" || cmd === "/q") process.exit(0)

  if (cmd === "/clear") {
    coordinator = createCoordinator()
    console.log("Context cleared.")
    return
  }

  if (cmd === "/history" || cmd === "/h") {
    const msgs = coordinator.state.messages
    console.log(`\n${msgs.length} messages in context:\n`)
    for (const m of msgs) {
      if (m.role === "user") {
        const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content)
        console.log(`  [user] ${truncate(text, 100)}`)
      } else if (m.role === "assistant") {
        for (const c of m.content) {
          if (c.type === "text") console.log(`  [assistant] ${truncate(c.text, 100)}`)
          if (c.type === "toolCall")
            console.log(`  [tool] ${c.name}(${truncate(JSON.stringify(c.arguments), 80)})`)
        }
      } else if (m.role === "toolResult") {
        const text = m.content.map((c) => ("text" in c ? c.text : "[image]")).join("")
        console.log(`  [result] ${truncate(text, 100)}`)
      }
    }
    console.log()
    return
  }

  if (cmd === "/solvers") {
    const solvers = coordinator.solvers
    const queue = coordinator.challengeQueue
    console.log(`\n  Active solvers: ${solvers.size}`)
    for (const [id, s] of solvers) {
      console.log(
        `    ${id}: ${s.state.messages.length} messages, streaming=${s.state.isStreaming}`,
      )
    }
    console.log(`  Queued challenges: ${queue.length}`)
    for (const c of queue) {
      console.log(`    ${c.challengeId}: ${c.challengeName}`)
    }
    console.log()
    return
  }

  if (cmd === "/info") {
    const s = coordinator.state
    console.log(`  Messages: ${s.messages.length}`)
    console.log(`  Streaming: ${s.isStreaming}`)
    console.log(`  Model: ${rawModel}`)
    console.log(`  ThinkingLevel: ${s.thinkingLevel}`)
    console.log(`  Tools: ${s.tools.map((t) => t.name).join(", ")}`)
    console.log(`  Pool available: ${coordinator.modelPool.available}`)
    console.log(`  Prompt: ${s.systemPrompt}`)
    return
  }

  console.log("Commands: /history, /clear, /info, /solvers, /quit")
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "..." : s
}

function printGray(s: string) {
  console.log(`\x1b[90m${s}\x1b[0m`)
}
function printRed(s: string) {
  console.log(`\x1b[31m${s}\x1b[0m`)
}
function printGreen(s: string) {
  console.log(`\x1b[32m${s}\x1b[0m`)
}
