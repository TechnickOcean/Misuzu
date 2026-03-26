import {
  Agent,
  type AgentTool,
  type AgentMessage,
  type AgentEvent,
  type AgentState,
} from "@mariozechner/pi-agent-core"
import type { Model } from "@mariozechner/pi-ai"
import { type Skill, buildSkillsCatalog } from "../features/skill.ts"
import { convertToLlm } from "../features/messages.ts"
import { checkCompact, compact } from "../features/compaction.ts"
import { baseTools } from "../tools/index.ts"

export interface FeaturedAgentOptions {
  initialState?: Partial<AgentState>
  skills?: Skill[]
  cwd?: string
  tools?: AgentTool<any>[]
  convertToLlm?: (messages: AgentMessage[]) => ReturnType<typeof convertToLlm>
  transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>
  [key: string]: unknown
}

export class FeaturedAgent {
  private agent: Agent

  constructor({
    skills = [],
    cwd: _cwd,
    tools,
    convertToLlm: customConvertToLlm,
    transformContext: customTransformContext,
    ...opts
  }: FeaturedAgentOptions) {
    const skillCatalog = buildSkillsCatalog(skills)

    this.agent = new Agent({
      ...opts,
      initialState: {
        ...opts.initialState,
        systemPrompt: (opts.initialState?.systemPrompt ?? "") + skillCatalog,
        tools: tools ?? baseTools,
        thinkingLevel: opts.initialState?.thinkingLevel ?? "minimal",
      },
      convertToLlm: customConvertToLlm ?? convertToLlm,
      transformContext:
        customTransformContext ??
        (async (messages, _signal) => {
          if (checkCompact(this.agent)) {
            return compact(this.agent)
          }
          return messages
        }),
    })
  }

  get state() {
    return this.agent.state
  }

  get innerAgent() {
    return this.agent
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
    this.agent.steer({ role: "user", content: message, timestamp: Date.now() } as AgentMessage)
  }

  followUp(message: string) {
    this.agent.followUp({ role: "user", content: message, timestamp: Date.now() } as AgentMessage)
  }
}
