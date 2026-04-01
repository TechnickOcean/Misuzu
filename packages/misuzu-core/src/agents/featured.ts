import {
  Agent,
  type AgentTool,
  type AgentMessage,
  type AgentEvent,
  type AgentState,
} from "@mariozechner/pi-agent-core"
import type { Model } from "@mariozechner/pi-ai"
import { type Skill, buildSkillsCatalog } from "../agents/features/skill.ts"
import { convertToLlm } from "./features/messages/index.ts"
import { checkCompact, compact } from "./features/compaction.ts"
import type { Logger } from "../core/infrastructure/logging/types.ts"
import type { PersistenceStore } from "../core/application/persistence/store.ts"
import type { ProviderRegistry } from "../core/application/providers/index.ts"
import type { SessionContext } from "../core/application/session/context.ts"
import { createBaseTools } from "../tools/index.ts"
import { textFromMessage } from "./features/utils.ts"

export interface FeaturedAgentDependencies {
  cwd: string
  logger: Logger
  providers: ProviderRegistry
  persistence: PersistenceStore
  session: SessionContext
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
    const skillCatalog = buildSkillsCatalog(skills)
    const inheritedApiKeyResolver =
      typeof opts.getApiKey === "function" ? (opts.getApiKey as ApiKeyResolver) : undefined
    this.logger = deps.logger.child({ sessionId: deps.session.sessionId })

    this.agent = new Agent({
      ...opts,
      sessionId: deps.session.sessionId,
      getApiKey: async (provider) => {
        const proxyProviderApiKey = deps.providers.getApiKey(provider)
        if (proxyProviderApiKey !== undefined) {
          return proxyProviderApiKey
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
        void Promise.resolve(
          deps.persistence.recordAgentEvent(deps.session.sessionId, event),
        ).catch((error) => {
          this.logger.warn("Failed to record agent event", { eventType: event.type }, error)
        })
        switch (event.type) {
          case "agent_end":
            this.logger.warn(
              "[Agent] Loop Ended",
              event.messages
                .filter((m) => m.role === "assistant")
                .map((m) => `${m.stopReason}\n${m.errorMessage}`)
                .join("\n"),
            )
            break
          case "tool_execution_start":
            this.logger.info(
              `[ToolCall] ${event.toolName}(${JSON.stringify(event.args).slice(0, 300)})`,
            )
            break
          case "tool_execution_end":
            if (event.isError)
              this.logger.error(
                `[ToolError] ${event.toolName} -> ${JSON.stringify(event.result).slice(0, 300)}`,
              )
            else
              this.logger.info(
                `[ToolResult] ${event.toolName} -> ${JSON.stringify(event.result).slice(0, 300)}`,
              )
            break
          case "message_end":
            this.logger.debug("[Message]", textFromMessage(event.message))
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
    this.logger.info(`[User] ${args[0]}`)
    try {
      const startTime = Date.now()
      await this.agent.prompt(...args)
      this.logger.info(`[Finish] output ended, duration(ms): ${Date.now() - startTime}`)
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
    return this.agent.continue()
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
        this.logger.info("[Compacted]", compacted)
        return compacted
      }
      // silently fail for now
    } catch (e) {
      this.logger.error(`[Compaction] Failed to compact the context due to ${(e as Error).message}`)
      throw e
    }
  }
}
