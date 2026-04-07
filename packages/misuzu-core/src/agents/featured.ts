import {
  Agent,
  type AgentTool,
  type AgentMessage,
  type AgentEvent,
  type AgentState,
} from "@mariozechner/pi-agent-core"
import { getEnvApiKey, type Model } from "@mariozechner/pi-ai"
import { type Skill, buildSkillsCatalog } from "../agents/features/skill.ts"
import { convertToLlm } from "./features/messages/index.ts"
import { checkCompact, compact } from "./features/compaction.ts"
import type { Logger } from "../core/infrastructure/logging/types.ts"
import type { PersistenceStore } from "../core/application/persistence/store.ts"
import type { ProviderRegistry } from "../core/application/providers/registry.ts"
import { createBaseTools } from "../tools/index.ts"
import { textFromMessage } from "./features/utils.ts"

export interface FeaturedAgentDependencies {
  cwd: string
  logger: Logger
  providers: ProviderRegistry
  persistence: PersistenceStore
}

export interface FeaturedAgentOptions {
  initialState?: Partial<AgentState>
  skills?: Skill[]
  tools?: AgentTool<any>[]
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined
  transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>
  [key: string]: unknown
}

type ApiKeyResolver = (provider: string) => Promise<string | undefined> | string | undefined

export class FeaturedAgent {
  agent: Agent
  private readonly logger: Logger
  constructor(
    deps: FeaturedAgentDependencies,
    {
      skills = [],
      tools,
      transformContext: customTransformContext,
      ...opts
    }: FeaturedAgentOptions = {},
  ) {
    this.logger = deps.logger.child({ component: this.constructor.name })
    const skillCatalog = buildSkillsCatalog(skills)
    const inheritedApiKeyResolver =
      typeof opts.getApiKey === "function" ? (opts.getApiKey as ApiKeyResolver) : undefined

    this.agent = new Agent({
      ...opts,
      getApiKey: async (provider) => {
        const proxyProviderApiKey = deps.providers.getApiKey(provider)
        if (proxyProviderApiKey !== undefined) {
          return proxyProviderApiKey
        }

        const envApiKey = getEnvApiKey(provider)
        if (envApiKey !== undefined) {
          return envApiKey
        }

        if (inheritedApiKeyResolver) {
          return inheritedApiKeyResolver(provider)
        }
        return undefined
      },
      initialState: {
        ...opts.initialState,
        systemPrompt: `${opts.initialState?.systemPrompt ?? ""}\n${skillCatalog}`,
        tools: tools ?? createBaseTools(deps.cwd),
        thinkingLevel: opts.initialState?.thinkingLevel ?? "medium",
      },
      convertToLlm,
      transformContext: async (messages, signal) => {
        if (checkCompact(this.agent)) {
          messages = await compact(this.agent)
        }
        return customTransformContext ? customTransformContext(messages, signal) : messages
      },
    })

    this.agent.subscribe((event) => {
      try {
        switch (event.type) {
          case "agent_end":
            this.logger.warn(
              "Agent loop ended",
              event.messages
                .filter((m) => m.role === "assistant")
                .map((m) => `${m.stopReason}\n${m.errorMessage}`)
                .join("\n"),
            )
            break
          case "tool_execution_start":
            this.logger.info(
              `Tool call started: ${event.toolName}(${JSON.stringify(event.args).slice(0, 300)})`,
            )
            break
          case "tool_execution_end":
            if (event.isError)
              this.logger.error(
                `Tool call failed: ${event.toolName} -> ${JSON.stringify(event.result).slice(0, 300)}`,
              )
            else
              this.logger.info(
                `Tool call completed: ${event.toolName} -> ${JSON.stringify(event.result).slice(0, 300)}`,
              )
            break
          case "message_end":
            this.logger.debug("Message received", textFromMessage(event.message))
            break
        }
      } catch (error) {
        this.logger.warn(
          "Failed to send agent event to persistence",
          { eventType: event.type },
          error,
        )
      }
    })
  }

  get state() {
    return this.agent.state
  }

  subscribe(fn: (e: AgentEvent) => void) {
    return this.agent.subscribe(fn)
  }

  async prompt(...args: Parameters<Agent["prompt"]>) {
    this.logger.info(`User prompt: ${args[0]}`)
    try {
      const startTime = Date.now()
      await this.agent.prompt(...args)
      this.logger.info(`Prompt finished, duration(ms): ${Date.now() - startTime}`)
    } catch (error) {
      this.logger.error("Agent prompt failed", error)
      throw error
    }
  }

  abort() {
    this.agent.abort()
  }

  async waitForIdle() {
    return this.agent.waitForIdle()
  }

  setTools(tools: AgentTool<any>[]) {
    this.agent.setTools(tools)
  }

  setSystemPrompt(prompt: string) {
    this.agent.setSystemPrompt(prompt)
  }

  setModel(model: Model<any>) {
    this.agent.setModel(model)
  }

  replaceMessages(messages: AgentMessage[]) {
    this.agent.replaceMessages(messages)
  }

  appendMessage(message: AgentMessage) {
    this.agent.appendMessage(message)
  }

  continue() {
    this.logger.info("continued")
    if (this.agent.state.isStreaming) throw new Error("Cannot continue a running agent!")
    const lastMessage = this.agent.state.messages.at(-1)
    if (lastMessage?.role === "user") return this.agent.continue()
    else return this.agent.prompt("continue")
  }

  steer(message: string) {
    this.agent.steer({ role: "user", content: message, timestamp: Date.now() })
  }

  followUp(message: string) {
    this.agent.followUp({ role: "user", content: message, timestamp: Date.now() })
  }

  async compact() {
    try {
      this.abort()
      const compacted = await compact(this.agent)
      if (compacted) {
        this.agent.replaceMessages(compacted)
        this.logger.info("Context compacted", compacted)
        return compacted
      }
      // silently fail for now
    } catch (e) {
      this.logger.error(`Failed to compact context: ${(e as Error).message}`)
      throw e
    }
  }
}
