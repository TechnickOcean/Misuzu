import { runCTFAgent } from "@/agents/CTFAgent"
import { type EnvAgentInput, runEnvAgent } from "@/agents/EnvAgent"
import { getDBWorkspace } from "@/tools/workspace/core/db"

export interface OrchestratorInput {
  env: EnvAgentInput
  model: "glm-4.7-flash" | "llama-4-scout-17b-16e-instruct" | "qwen3-30b-a3b-fp8"
}

export async function runCTFOrchestrator(input: OrchestratorInput) {
  const envResult = await runEnvAgent(input.env)

  await runCTFAgent({
    workspace_id: envResult.workspace_id,
    model: input.model
  })

  const workspace = await getDBWorkspace({ id: envResult.workspace_id })
  const store = workspace?.store as { status?: string } | null
  if (store?.status === "blocked") {
    // AgentHiro dispatch should be triggered by CTFAgent in real flow.
    // This is a placeholder hook for future conditional scheduling.
  }
}

await runCTFAgent({
  workspace_id: 1,
  model: "qwen3-30b-a3b-fp8"
})
