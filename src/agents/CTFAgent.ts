import ToolLoopAgent from "@/agents/base/ToolLoopAgent"
import { getDBWorkspace, updateDBWorkspace } from "@/tools/workspace/core/db"
import type { WorkspaceStore } from "@/tools/workspace/helpers"
import { globTool, grepTool, readFileTool, shellTool, stateTool, writeFileTool } from "@/tools/workspace/workspace"
import { AppError } from "@/utils/errors"

export interface CTFAgentInput {
  workspace_id: number
  model: "glm-4.7-flash" | "llama-4-scout-17b-16e-instruct" | "qwen3-30b-a3b-fp8"
}

function buildContextPrompt(store: WorkspaceStore | null, envMd: string, fileTree: string) {
  const knowledge = store?.knowledge_index ?? []
  const findings = store?.findings ?? []
  const progress = store?.progress ?? []

  return [
    "You are CTFAgent, responsible for solving the challenge.",
    "Use tools to inspect files, run commands, and gather evidence.",
    "When knowledge is insufficient, explicitly request AgentHiro.",
    "",
    "## Environment",
    envMd,
    "",
    "## Workspace Files",
    fileTree || "(empty)",
    "",
    "## Findings",
    findings.length ? JSON.stringify(findings, null, 2) : "(none)",
    "",
    "## Knowledge Index",
    knowledge.length ? JSON.stringify(knowledge, null, 2) : "(none)",
    "",
    "## Recent Progress",
    progress.slice(-10).length ? JSON.stringify(progress.slice(-10), null, 2) : "(none)"
  ].join("\n")
}

export async function runCTFAgent(input: CTFAgentInput) {
  const workspace = await getDBWorkspace({ id: input.workspace_id })
  if (!workspace) throw new AppError("NOT_FOUND", "Workspace not found", { workspace_id: input.workspace_id })

  const envMd = await readFileTool.execute(
    JSON.stringify({ file_path: "Environment.md", workspace_id: input.workspace_id })
  )

  const fileTree = await globTool.execute(JSON.stringify({ pattern: "**/*", workspace_id: input.workspace_id }))

  const store = (workspace.store as WorkspaceStore | null) ?? null
  const prompt = buildContextPrompt(store, JSON.parse(envMd), JSON.parse(fileTree))

  await updateDBWorkspace({
    id: input.workspace_id,
    data: {
      store: {
        ...(store ?? {}),
        status: "running",
        current_step: "ctf_agent"
      }
    }
  })

  const agent = new ToolLoopAgent({
    model: input.model,
    instruction: prompt,
    tools: [readFileTool, writeFileTool, globTool, grepTool, shellTool, stateTool]
  })

  await agent.generate({
    prompt:
      "Start solving. If you need external knowledge, stop and ask for AgentHiro. " +
      "If you obtain the final flag, write the exploit script to solution/ and update WriteUp.md with reproducible steps."
  })
}
