import { Type } from "@sinclair/typebox"
import type { Model } from "@mariozechner/pi-ai"
import { FeaturedAgent, type FeaturedAgentOptions } from "./misuzu-featured.ts"
import { Solver } from "./misuzu-solver.ts"
import { createReadOnlyTools } from "../tools/index.ts"
import { bashTool } from "../tools/base/bash.ts"
import { requestrepoTools } from "../tools/misuzu/requestrepo.ts"
import type { FlagResultMessage } from "../features/messages.ts"
import { loadBuiltinSkills, type Skill } from "../features/skill.ts"

export interface ModelSlot {
  model: string
  status: "idle" | "busy"
  solverId?: string
}

export class ModelPool {
  private slots: ModelSlot[]

  constructor(models: string[]) {
    this.slots = models.map((model) => ({ model, status: "idle" }))
  }

  acquire(solverId: string): string | null {
    const slot = this.slots.find((s) => s.status === "idle")
    if (!slot) return null
    slot.status = "busy"
    slot.solverId = solverId
    return slot.model
  }

  release(solverId: string): void {
    const slot = this.slots.find((s) => s.solverId === solverId)
    if (slot) {
      slot.status = "idle"
      slot.solverId = undefined
    }
  }

  get available(): number {
    return this.slots.filter((s) => s.status === "idle").length
  }

  toJSON(): ModelSlot[] {
    return [...this.slots]
  }
}

export interface CoordinatorOptions {
  cwd?: string
  ctfPlatformUrl?: string
  models?: string[]
  model?: Model<any>
  modelPool?: ModelPool
}

export interface Challenge {
  id: string
  name: string
  category: string
  description: string
  difficulty?: number
  files?: string[]
  points?: number
}

export class Coordinator extends FeaturedAgent {
  readonly modelPool: ModelPool
  readonly solvers: Map<string, Solver> = new Map()
  readonly challengeQueue: Array<{
    challengeId: string
    challengeName: string
    category: string
    description: string
    difficulty?: number
    files?: string[]
  }> = []

  constructor(options: CoordinatorOptions & FeaturedAgentOptions = {}) {
    const cwd = options.cwd ?? process.cwd()
    const modelPool = options.modelPool ?? new ModelPool(options.models ?? [])
    const skills: Skill[] = [...(options.skills ?? []), ...loadBuiltinSkills()]

    const tools = [...createReadOnlyTools(cwd), bashTool, ...requestrepoTools]

    const systemPrompt = buildCoordinatorSystemPrompt(options)

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

    this.modelPool = modelPool
  }

  getCreateSolverTool() {
    const solverParams = Type.Object({
      challengeId: Type.String({ description: "Challenge ID from the platform" }),
      challengeName: Type.String({ description: "Challenge name" }),
      category: Type.String({
        description: "Challenge category (crypto, pwn, web, forensics, reversing, misc)",
      }),
      description: Type.String({ description: "Challenge description" }),
      difficulty: Type.Optional(Type.Number({ description: "Estimated difficulty 1-5" })),
      files: Type.Optional(
        Type.Array(Type.String(), { description: "URLs to challenge attachments" }),
      ),
    })

    return {
      name: "create_solver",
      label: "Create Solver",
      description:
        "Create a new solver agent for a challenge. " +
        "Automatically selects an idle model from the pool. " +
        "Queues the challenge if no models are available.",
      parameters: solverParams,
      execute: async (_toolCallId: string, rawParams: unknown) => {
        const params = rawParams as {
          challengeId: string
          challengeName: string
          category: string
          description: string
          difficulty?: number
          files?: string[]
        }
        const model = this.modelPool.acquire(params.challengeId)
        if (!model) {
          this.challengeQueue.push(params)
          return {
            content: [
              {
                type: "text" as const,
                text: `No models available. Challenge "${params.challengeName}" queued (${this.challengeQueue.length} in queue).`,
              },
            ],
            details: { queued: true, queueLength: this.challengeQueue.length },
          }
        }

        const solver = new Solver({
          cwd: `/tmp/ctf-${params.challengeId}`,
          challengeDescription: params.description,
        })

        this.solvers.set(params.challengeId, solver)

        solver.subscribe((event) => {
          if (event.type === "message_end" && event.message.role === "flagResult") {
            this.appendMessage({
              role: "user" as const,
              content: `Solver for "${params.challengeName}" found a flag: ${(event.message as unknown as FlagResultMessage).flag}`,
              timestamp: Date.now(),
            } as any)
          }
          if (event.type === "agent_end") {
            this.onSolverFinished(params.challengeId)
          }
        })

        await solver.solve(
          `Challenge: ${params.challengeName}\nCategory: ${params.category}\n\n${params.description}`,
        )

        return {
          content: [
            {
              type: "text",
              text: `Solver started for "${params.challengeName}" on model ${model}`,
            },
          ],
          details: { model, solverId: params.challengeId },
        }
      },
    }
  }

  private onSolverFinished(solverId: string) {
    this.modelPool.release(solverId)
    this.solvers.delete(solverId)

    if (this.challengeQueue.length > 0 && this.modelPool.available > 0) {
      const next = this.challengeQueue.shift()!
      // Queue follow-up to create next solver
      this.appendMessage({
        role: "user",
        content: `Model freed. Create a solver for queued challenge: ${next.challengeName} (ID: ${next.challengeId})`,
        timestamp: Date.now(),
      } as any)
    }
  }
}

function buildCoordinatorSystemPrompt(_options: CoordinatorOptions) {
  return `You are a CTF team coordinator. Your job is to:

1. Navigate to the CTF platform and fetch all challenges
   with their titles, descriptions, attachments, categories, remote environment URLs and so on
2. Estimate difficulty and sort challenges (easiest first)
3. Assign Solver agents to challenges using create_solver
   - Each solver needs one model from the pool
   - If no models are available, challenges are queued automatically
4. When a solver finds a flag, submit it to the platform
5. Forward platform announcements to active solvers
6. Notify the user of progress

Workflow:
- Use browser to navigate and extract challenge information
- Call create_solver for each challenge (easiest first)
- The system handles model allocation and queuing automatically
- Use bash to submit flags when solvers report them
- Remote environment may have quantitative limits, do not try to launch a wnv again when being informed reached the limit.`
}
