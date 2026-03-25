import { createInterface } from "node:readline";
import { type KnownProvider, getModels } from "@mariozechner/pi-ai";
import type { Model } from "@mariozechner/pi-ai";
import { Solver } from "misuzu-core";

const args = process.argv.slice(2);
const rawModel = args[0] ?? "openrouter/anthropic/claude-sonnet-4";
const [provider, ...modelParts] = rawModel.split("/");
const modelId = modelParts.join("/");
const typedProvider = provider as KnownProvider;

function loadModel(): Model<any> {
  const models = getModels(typedProvider);
  const found = models.find((m) => m.id === modelId);
  if (found) return found;
  console.error(`Unknown model: ${rawModel}`);
  console.error(`Available: ${models.map((m) => m.id).join(", ")}`);
  process.exit(1);
}

console.log(`misuzu-cli — model: ${rawModel}`);
console.log("Type a prompt to chat. Commands: /history, /clear, /info, /quit\n");

let solver = new Solver({ model: loadModel(), cwd: process.cwd() });
watchSolver(solver);

function watchSolver(s: Solver) {
  s.subscribe((event) => {
    switch (event.type) {
      case "tool_execution_start":
        printGray(`  ⚙ ${event.toolName}(${truncate(JSON.stringify(event.args), 120)})`);
        break;
      case "tool_execution_end":
        printGray(`  ✓ ${event.toolName} done`);
        break;
      case "message_end": {
        const msg = event.message;
        if (msg.role === "assistant") {
          for (const c of msg.content) {
            if (c.type === "text" && c.text.trim()) {
              console.log(c.text);
            }
          }
        }
        break;
      }
    }
  });
}

const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "> " });
rl.prompt();

rl.on("line", async (line) => {
  const input = line.trim();
  if (!input) {
    rl.prompt();
    return;
  }

  if (input.startsWith("/")) {
    handleCommand(input);
    rl.prompt();
    return;
  }

  try {
    await solver.prompt(input);
  } catch (e) {
    printRed(`Error: ${String(e)}`);
  }

  rl.prompt();
});

rl.on("close", () => {
  console.log("\nBye!");
  process.exit(0);
});

function handleCommand(input: string) {
  const cmd = input.toLowerCase();
  if (cmd === "/quit" || cmd === "/q") process.exit(0);

  if (cmd === "/clear") {
    solver = new Solver({ model: loadModel(), cwd: process.cwd() });
    watchSolver(solver);
    console.log("Context cleared.");
    return;
  }

  if (cmd === "/history" || cmd === "/h") {
    const msgs = solver.state.messages;
    console.log(`\n${msgs.length} messages in context:\n`);
    for (const m of msgs) {
      if (m.role === "user") {
        const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
        console.log(`  [user] ${truncate(text, 100)}`);
      } else if (m.role === "assistant") {
        for (const c of m.content) {
          if (c.type === "text") console.log(`  [assistant] ${truncate(c.text, 100)}`);
          if (c.type === "toolCall")
            console.log(`  [tool] ${c.name}(${truncate(JSON.stringify(c.arguments), 80)})`);
        }
      } else if (m.role === "toolResult") {
        const text = m.content.map((c) => ("text" in c ? c.text : "[image]")).join("");
        console.log(`  [result] ${truncate(text, 100)}`);
      }
    }
    console.log();
    return;
  }

  if (cmd === "/info") {
    const s = solver.state;
    console.log(`  Messages: ${s.messages.length}`);
    console.log(`  Streaming: ${s.isStreaming}`);
    console.log(`  Model: ${rawModel}`);
    console.log(`  Tools: ${s.tools.map((t) => t.name).join(", ")}`);
    return;
  }

  console.log("Commands: /history, /clear, /info, /quit");
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}

function printGray(s: string) {
  console.log(`\x1b[90m${s}\x1b[0m`);
}
function printRed(s: string) {
  console.log(`\x1b[31m${s}\x1b[0m`);
}
