import type { Model } from "@mariozechner/pi-ai"
import { mkdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { FeaturedAgent, type FeaturedAgentOptions } from "./misuzu-featured.ts"
import { createBaseTools } from "../tools/index.ts"
import { dockerTools } from "../tools/misuzu/docker.ts"
import type { AgentTool } from "@mariozechner/pi-agent-core"
import { loadAgentSkills } from "../features/skill.ts"

export interface SolverOptions {
  solverId?: string
  cwd?: string
  workspaceRoot?: string
  environmentFilePath?: string
  scriptsDir?: string
  writeupPath?: string
  challengeDescription?: string
  challengeUrl?: string
  sandboxImage?: string
  model?: Model<any>
  tools?: AgentTool<any>[]
}

export class Solver extends FeaturedAgent {
  readonly solverId: string
  readonly environmentFilePath?: string
  readonly scriptsDir?: string
  readonly writeupPath?: string

  constructor(options: SolverOptions & FeaturedAgentOptions = {}) {
    const solverId = options.solverId ?? "solver"
    const sandboxImage = options.sandboxImage ?? "2d4e4aeb76eb"
    const workspaceRoot = options.workspaceRoot ?? process.cwd()
    const cwd = resolve(options.cwd ?? resolve(workspaceRoot, ".misuzu", "solvers", solverId))

    mkdirSync(cwd, { recursive: true })

    const tools = options.tools ?? [...createBaseTools(cwd), ...dockerTools]
    const skills = loadAgentSkills({
      role: "solver",
      launchDir: workspaceRoot,
      extraSkills: options.skills,
    })

    const systemPrompt = buildSolverSystemPrompt(options, sandboxImage)

    super({
      ...options,
      cwd,
      skills,
      tools,
      initialState: {
        ...options.initialState,
        model: options.model,
        systemPrompt,
      },
    })

    this.solverId = solverId
    this.environmentFilePath = options.environmentFilePath
    this.scriptsDir = options.scriptsDir
    this.writeupPath = options.writeupPath
  }

  async solve(challenge: string) {
    const prompt = this.buildChallengePrompt(challenge)
    return this.prompt(prompt)
  }

  refreshEnvironmentContext(reason: string) {
    const envContent = this.loadEnvironmentSnapshot()
    if (!envContent || !this.environmentFilePath) return

    this.steer(
      [
        `Coordinator updated environment context (${reason}).`,
        `Re-read and follow ${this.environmentFilePath}.`,
        "",
        envContent,
      ].join("\n"),
    )
  }

  notifyFlagConfirmed(message = "") {
    const writeupPath = this.writeupPath ?? "Writeups.md"
    const scriptsDir = this.scriptsDir ?? "scripts"

    this.steer(
      [
        "Coordinator confirmed your submitted flag is CORRECT.",
        "Immediately write a reproducible solution to Writeups.md.",
        `Writeup file: ${writeupPath}`,
        `Store executable artifacts under: ${scriptsDir}`,
        message ? `Notes: ${message}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    )
  }

  private buildChallengePrompt(challenge: string): string {
    const envSnapshot = this.loadEnvironmentSnapshot()
    if (!envSnapshot || !this.environmentFilePath) {
      return challenge
    }

    return [
      `Primary challenge context is maintained in ${this.environmentFilePath}.`,
      "Always align your actions with that file.",
      "Before remote exploitation, verify current url from ENVIRONMENT.md is still valid.",
      "If url is expired/unreachable, call notify_coordinator(kind=environment_expired) and wait for coordinator refresh.",
      "",
      "ENVIRONMENT.md snapshot:",
      envSnapshot,
      "",
      "Task:",
      challenge,
    ].join("\n")
  }

  private loadEnvironmentSnapshot(): string | undefined {
    if (!this.environmentFilePath) return undefined
    try {
      return readFileSync(this.environmentFilePath, "utf-8")
    } catch {
      return undefined
    }
  }
}

function buildSolverSystemPrompt(_options: SolverOptions, sandboxImage: string) {
  return `You are an expert CTF player. Your goal is to find the flag for the given challenge. The flag format is typically CTF{...} or flag{...}.

You have access to an isolated Docker container (image: ${sandboxImage}) for local testing and exploit development. 
The sandbox has pre-installed CTF tools including pwntools, pycryptodome, z3-solver, RsaCtfTool, radare2, angr, and many more (check out \`/tools.txt\` in the container to get a full list).

Use ENVIRONMENT.md as the source of truth for challenge environment data.
If remote URL is expired/unreachable, immediately call notify_coordinator with kind=environment_expired and PAUSE remote attacks until coordinator updates ENVIRONMENT.md.
Coordinator must refresh instance URL through browser workflow on platform challenge page and then call update_solver_environment.
Do not invent, guess, or auto-rotate instance URLs yourself.
Copy downloaded/received attachments into attachments/, write exploit helpers into scripts/, and produce final reproducible writeup in Writeups.md once a flag is confirmed correct.
If needed, use scripts/poll-platform-updates.sh (created during solver bootstrap) only for platform announcements/hints and report them via notify_coordinator.

Strategy:
1. Analyze the challenge description and attachments
2. Determine the challenge category (crypto, pwn, web, forensics, reversing, misc)
3. Examine files (read, file, strings, binwalk)
4. Build and run exploits in the sandbox using docker_run/docker_exec
5. Keep trying until you capture the flag

Never give up. If one approach fails, try another.`
}
