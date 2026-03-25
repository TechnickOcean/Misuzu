import {
  Agent,
  type AgentTool,
  type AgentMessage,
  type AgentEvent,
  type AgentState,
} from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";
import { type Skill, buildSkillsCatalog } from "../features/skill.ts";
import { checkCompact } from "../features/compaction.ts";
import { convertToLlm } from "../features/messages.ts";
import { baseTools } from "../builtins/tools/index.ts";

export interface FeaturedAgentOptions {
  initialState?: Partial<AgentState>;
  skills?: Skill[];
  cwd?: string;
  tools?: AgentTool<any>[];
  convertToLlm?: (messages: AgentMessage[]) => ReturnType<typeof convertToLlm>;
  [key: string]: unknown;
}

export class FeaturedAgent {
  private agent: Agent;

  constructor({
    skills = [],
    cwd: _cwd,
    tools,
    convertToLlm: customConvertToLlm,
    ...opts
  }: FeaturedAgentOptions) {
    const skillCatalog = buildSkillsCatalog(skills);

    this.agent = new Agent({
      ...opts,
      initialState: {
        ...opts.initialState,
        systemPrompt: (opts.initialState?.systemPrompt ?? "") + skillCatalog,
        tools: tools ?? baseTools,
        thinkingLevel: opts.initialState?.thinkingLevel ?? "minimal",
      },
      convertToLlm: customConvertToLlm ?? convertToLlm,
      transformContext: async (_messages, _signal) => {
        if (checkCompact(this.agent)) {
          // compaction will be triggered by the compaction hook
          // For now, just return messages (compaction needs LLM call)
        }
        return _messages;
      },
    });
  }

  get state(): AgentState {
    return this.agent.state;
  }

  get innerAgent(): Agent {
    return this.agent;
  }

  subscribe(fn: (e: AgentEvent) => void): () => void {
    return this.agent.subscribe(fn);
  }

  async prompt(...args: Parameters<Agent["prompt"]>): Promise<void> {
    return this.agent.prompt(...args);
  }

  abort(): void {
    this.agent.abort();
  }

  async waitForIdle(): Promise<void> {
    return this.agent.waitForIdle();
  }

  setTools(tools: AgentTool<any>[]): void {
    this.agent.setTools(tools);
  }

  setSystemPrompt(prompt: string): void {
    this.agent.setSystemPrompt(prompt);
  }

  setModel(model: Model<any>): void {
    this.agent.setModel(model);
  }

  replaceMessages(messages: AgentMessage[]): void {
    this.agent.replaceMessages(messages);
  }

  appendMessage(message: AgentMessage): void {
    this.agent.appendMessage(message);
  }
}
