import { readdir } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import type { AgentTool } from "@mariozechner/pi-agent-core"
import { SolverAgent } from "../../../../../agents/solver.ts"
import { createBaseTools } from "../../../../../tools/index.ts"
import type { PersistenceStore } from "../../../persistence/store.ts"
import type { ProviderRegistry } from "../../../providers/index.ts"
import type { Logger } from "../../../../infrastructure/logging/types.ts"
import {
  transformPluginToTools,
  type CTFPlatformPlugin,
  type ChallengeDetail,
  type ChallengeSummary,
} from "../../../../../../../../plugins/index.ts"
import type { RuntimeInitOptions } from "./orchestrator.ts"
import { type SolverTask, type SolverTaskResult, QueueService } from "./queue.ts"

export interface ChallengeSolverBinding {
  challenge: ChallengeSummary
  detail?: ChallengeDetail
  solverId: string
  solver: SolverAgent
}

export interface SolverHubDeps {
  rootDir: string
  logger: Logger
  providers: ProviderRegistry
  persistence: PersistenceStore
  queue: QueueService
}

export class SolverHub {
  private platformPlugin?: CTFPlatformPlugin
  private platformPluginId?: string
  private platformNoticeCursor?: string
  private readonly challengeSolvers = new Map<number, ChallengeSolverBinding>()

  private readonly rootDir: string
  private readonly logger: Logger
  private readonly providers: ProviderRegistry
  private readonly persistence: PersistenceStore
  private readonly queue: QueueService

  constructor(deps: SolverHubDeps) {
    this.rootDir = deps.rootDir
    this.logger = deps.logger
    this.providers = deps.providers
    this.persistence = deps.persistence
    this.queue = deps.queue
  }

  async initialize(options: RuntimeInitOptions) {
    if (this.platformPlugin) {
      throw new Error("[CTFRuntimeWorkspace] Platform runtime is already initialized")
    }

    const plugin =
      options.plugin ??
      (await this.resolvePluginOrThrow(options.pluginId, options.pluginConfig.baseUrl))
    const pluginId = options.pluginId ?? plugin.meta.id

    await plugin.setup(options.pluginConfig)
    await plugin.ensureAuthenticated()

    this.platformPlugin = plugin
    this.platformPluginId = pluginId
    this.platformNoticeCursor = undefined
  }

  getManagedChallengeIds() {
    return [...this.challengeSolvers.keys()]
  }

  getChallengeSolver(challengeId: number) {
    return this.challengeSolvers.get(challengeId)?.solver
  }

  getChallengeBindings() {
    return [...this.challengeSolvers.values()]
  }

  getChallengeBinding(challengeId: number) {
    return this.challengeSolvers.get(challengeId)
  }

  getPlugin() {
    if (!this.platformPlugin) {
      throw new Error("[CTFRuntimeWorkspace] Platform runtime is not initialized")
    }

    return this.platformPlugin
  }

  getPluginId() {
    return this.platformPluginId ?? this.getPlugin().meta.id
  }

  getNoticeCursor() {
    return this.platformNoticeCursor
  }

  setNoticeCursor(cursor: string | undefined) {
    this.platformNoticeCursor = cursor
  }

  async ensureChallengeSolver(challenge: ChallengeSummary) {
    const existing = this.challengeSolvers.get(challenge.id)
    if (existing) {
      return existing
    }

    const plugin = this.getPlugin()
    const detail = await plugin.getChallenge(challenge.id)

    const solverId = `solver-${challenge.id}`
    const solver = this.createSolver({
      initialState: {
        systemPrompt: buildChallengeSolverPrompt(challenge, detail, this.getPluginId()),
      },
    })

    const platformTools = transformPluginToTools(plugin, {
      namespace: this.getPluginId(),
    }) as unknown as AgentTool<any>[]
    solver.setTools([...createBaseTools(this.rootDir), ...platformTools])

    const binding: ChallengeSolverBinding = {
      challenge,
      detail,
      solver,
      solverId,
    }

    this.challengeSolvers.set(challenge.id, binding)
    this.queue.registerSolver({
      solverId,
      solve: async (task) => this.solveWithBinding(binding, task),
    })

    this.logger.info("[CTFRuntimeWorkspace] Challenge solver created", {
      challengeId: challenge.id,
      challengeTitle: challenge.title,
      solverId,
    })

    return binding
  }

  updateChallengeMetadata(challenge: ChallengeSummary) {
    const existing = this.challengeSolvers.get(challenge.id)
    if (!existing) {
      return false
    }

    const changed =
      existing.challenge.score !== challenge.score ||
      existing.challenge.solvedCount !== challenge.solvedCount ||
      existing.challenge.title !== challenge.title ||
      existing.challenge.category !== challenge.category

    if (!changed) {
      return false
    }

    const previous = existing.challenge
    existing.challenge = challenge
    existing.solver.steer(
      [
        `Platform challenge metadata updated for [${challenge.id}] ${challenge.title}.`,
        `Score: ${previous.score} -> ${challenge.score}`,
        `Solved count: ${previous.solvedCount} -> ${challenge.solvedCount}`,
        "Re-check whether this changes exploit assumptions or expected flag path.",
      ].join("\n"),
    )

    return true
  }

  private createSolver(options: ConstructorParameters<typeof SolverAgent>[1]) {
    return new SolverAgent(
      {
        cwd: this.rootDir,
        logger: this.logger.child({ component: "solver-agent" }),
        providers: this.providers,
        persistence: this.persistence,
      },
      options,
    )
  }

  private async solveWithBinding(binding: ChallengeSolverBinding, task: SolverTask) {
    const payloadText =
      typeof task.payload === "string" ? task.payload : JSON.stringify(task.payload, null, 2)

    await binding.solver.prompt(
      [
        `You are assigned to challenge [${binding.challenge.id}] ${binding.challenge.title}.`,
        `Category: ${binding.challenge.category}, score: ${binding.challenge.score}, solved: ${binding.challenge.solvedCount}.`,
        "Use platform tools carefully and avoid unnecessary requests.",
        `Task payload:\n${payloadText}`,
      ].join("\n"),
    )

    const output: SolverTaskResult["output"] = {
      challengeId: binding.challenge.id,
      solverId: binding.solverId,
      messageCount: binding.solver.state.messages.length,
    }

    return output
  }

  private async resolvePluginOrThrow(pluginId: string | undefined, baseUrl: string) {
    const pluginRootDir = join(this.rootDir, "plugins")
    const entries = await readdir(pluginRootDir, { withFileTypes: true }).catch(() => [])
    const pluginDirs = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)

    if (pluginId) {
      if (pluginDirs.length === 0) {
        throw new Error(
          `[CTFRuntimeWorkspace] Required plugin is missing: ${pluginId}. Available plugins: none`,
        )
      }

      if (!pluginDirs.includes(pluginId)) {
        throw new Error(
          `[CTFRuntimeWorkspace] Required plugin is missing: ${pluginId}. Available plugins: ${pluginDirs.join(", ")}`,
        )
      }

      return this.loadPluginById(pluginRootDir, pluginId)
    }

    if (pluginDirs.length === 0) {
      throw new Error(
        `[CTFRuntimeWorkspace] No plugins found under ${pluginRootDir}. Please provide a platform plugin first.`,
      )
    }

    for (const candidateId of pluginDirs) {
      const plugin = await this.loadPluginById(pluginRootDir, candidateId)
      if (plugin.meta.match(baseUrl)) {
        return plugin
      }
    }

    throw new Error(
      `[CTFRuntimeWorkspace] No plugin matched baseUrl: ${baseUrl}. Available plugins: ${pluginDirs.join(", ")}`,
    )
  }

  private async loadPluginById(pluginRootDir: string, pluginId: string) {
    const modulePath = join(pluginRootDir, pluginId, "index.ts")
    const moduleUrl = pathToFileURL(modulePath).href
    const pluginModule = (await import(moduleUrl)) as Record<string, unknown>

    const createPlugin = this.resolvePluginFactory(pluginModule)
    const plugin = createPlugin()
    const candidate = plugin as Partial<CTFPlatformPlugin> | null

    if (!candidate || typeof candidate !== "object" || typeof candidate.setup !== "function") {
      throw new Error(
        `[CTFRuntimeWorkspace] Invalid plugin module: ${pluginId}. Expected a plugin factory export from ${modulePath}.`,
      )
    }

    return candidate as CTFPlatformPlugin
  }

  private resolvePluginFactory(pluginModule: Record<string, unknown>) {
    const namedCreatePlugin = pluginModule.createPlugin
    if (typeof namedCreatePlugin === "function") {
      return namedCreatePlugin as () => unknown
    }

    for (const [name, value] of Object.entries(pluginModule)) {
      if (name.startsWith("create") && name.endsWith("Plugin") && typeof value === "function") {
        return value as () => unknown
      }
    }

    const defaultExport = pluginModule.default
    if (typeof defaultExport === "function") {
      return () => {
        try {
          return new (defaultExport as new () => unknown)()
        } catch {
          return (defaultExport as () => unknown)()
        }
      }
    }

    if (defaultExport && typeof defaultExport === "object") {
      return () => defaultExport
    }

    throw new Error("Plugin module has no supported factory export")
  }
}

function buildChallengeSolverPrompt(
  challenge: ChallengeSummary,
  detail: ChallengeDetail,
  pluginId: string,
) {
  const attachments = detail.attachments.length
    ? detail.attachments.map((item) => `- ${item.name} (${item.kind}): ${item.url}`).join("\n")
    : "- none"

  const hints = detail.hints.length ? detail.hints.map((hint) => `- ${hint}`).join("\n") : "- none"

  return [
    `Assigned platform plugin: ${pluginId}`,
    `Assigned challenge id: ${challenge.id}`,
    `Title: ${challenge.title}`,
    `Category: ${challenge.category}`,
    `Score: ${challenge.score}`,
    `Solved count: ${challenge.solvedCount}`,
    "Challenge description:",
    detail.content,
    "Hints:",
    hints,
    "Attachments:",
    attachments,
  ].join("\n")
}
