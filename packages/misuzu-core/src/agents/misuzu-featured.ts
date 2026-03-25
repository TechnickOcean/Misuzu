import { Agent, type AgentOptions } from "@mariozechner/pi-agent-core";
import { checkCompact } from "../features/compaction.ts";

type FeaturedAgentOptions = AgentOptions & { skills?: unknown[] };

export class FeaturedAgent {
  private agent: Agent;
  constructor({ skills: _skills, ...opts }: FeaturedAgentOptions) {
    this.agent = new Agent(opts);
    this.agent.subscribe(async (e) => {
      if (["message_start", "agent_end"].includes(e.type)) {
        checkCompact(this.agent);
      }
    });
  }
}
