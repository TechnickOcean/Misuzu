import type { Model } from "@mariozechner/pi-ai"
import { FeaturedAgent, type FeaturedAgentOptions } from "./misuzu-featured.ts"
import { createBaseTools } from "../tools/index.ts"
import { dockerTools } from "../tools/misuzu/docker.ts"
import type { AgentTool } from "@mariozechner/pi-agent-core"

export interface SolverOptions {
  cwd?: string
  challengeDescription?: string
  challengeUrl?: string
  sandboxImage?: string
  model?: Model<any>
  tools?: AgentTool<any>[]
}

export class Solver extends FeaturedAgent {
  constructor(options: SolverOptions & FeaturedAgentOptions = {}) {
    const cwd = options.cwd ?? "/tmp/ctf-solver"
    const sandboxImage = options.sandboxImage ?? "ctf-sandbox"

    const tools = options.tools ?? [...createBaseTools(cwd), ...dockerTools]

    const systemPrompt = buildSolverSystemPrompt(options, sandboxImage)

    super({
      ...options,
      cwd,
      tools,
      initialState: {
        ...options.initialState,
        model: options.model,
        systemPrompt,
      },
    })
  }

  async solve(challenge: string) {
    return this.prompt(challenge)
  }
}

function buildSolverSystemPrompt(_options: SolverOptions, sandboxImage: string) {
  return `You are an expert CTF player. Your goal is to find the flag for the given challenge. The flag format is typically CTF{...} or flag{...}.

You have access to an isolated Docker container (image: ${sandboxImage}) for local testing and exploit development. 
The sandbox has pre-installed CTF tools including pwntools, pycryptodome, z3-solver, RsaCtfTool, radare2, angr, and many more (check out \`/tools.txt\` in the container to get a full list).

Strategy:
1. Analyze the challenge description and attachments
2. Determine the challenge category (crypto, pwn, web, forensics, reversing, misc)
3. Examine files (read, file, strings, binwalk)
4. Build and run exploits in the sandbox using docker_run/docker_exec
5. Keep trying until you capture the flag

Never give up. If one approach fails, try another.`
}
