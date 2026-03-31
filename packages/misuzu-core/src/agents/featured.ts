import {
  Agent,
  type AgentTool,
  type AgentMessage,
  type AgentEvent,
  type AgentState,
} from "@mariozechner/pi-agent-core"
import type { Model } from "@mariozechner/pi-ai"
import { type Skill, buildSkillsCatalog } from "../features/skill.ts"
import { convertToLlm } from "../features/messages/index.ts"
import { checkCompact, compact } from "../features/compaction.ts"
import type { PersistenceStore } from "../persistence/store.ts"
import type { ProviderRegistry } from "../providers/index.ts"
import type { SessionContext } from "../session/context.ts"
import { createBaseTools } from "../tools/index.ts"

export interface FeaturedAgentDependencies {
  cwd: string
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
        ).catch(() => {})
      } catch {}
    })
  }

  get state() {
    return this.agent.state
  }

  subscribe(fn: (e: AgentEvent) => void) {
    return this.agent.subscribe(fn)
  }

  async prompt(...args: Parameters<Agent["prompt"]>) {
    return this.agent.prompt(...args)
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
}
