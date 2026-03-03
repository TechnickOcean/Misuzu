import { readAgentState, writeAgentState } from "@/agents/base/agentState"
import ToolLoopAgent from "@/agents/base/ToolLoopAgent"
import {
  ghGetContent,
  ghListReleases,
  ghListSecurityAdvisories,
  ghSearchCode,
  ghSearchRepos
} from "@/tools/websearch/githubSearch"
import { fetchMarkdown, websearch } from "@/tools/websearch/websearch"
import { getDBWorkspace, updateDBWorkspace } from "@/tools/workspace/core/db"
import type { WorkspaceStore } from "@/tools/workspace/helpers"
import {
  createAppendKnowledgeTool,
  createReadFileTool,
  createShellTool,
  createStateTool,
  createWriteFileTool
} from "@/tools/workspace/workspace"
import { AppError } from "@/utils/errors"

export interface AgentHiroInput {
  workspace_id: number
  model: "glm-4.7-flash" | "llama-4-scout-17b-16e-instruct" | "qwen3-30b-a3b-fp8"
  questions: string[]
}

function buildHiroPrompt(questions: string[]) {
  return [
    "You are AgentHiro. Gather accurate information to resolve the following questions.",
    "Use tools to verify and cross-check sources.",
    "Produce a reproducible report in knowledges/ and summarize it in the workspace store.",
    "The report must follow this template:",
    "# Knowledge Report: <title>",
    "## Summary",
    "- <bullet points>",
    "",
    "## Sources",
    "- <url>",
    "",
    "## Reproduction / Evidence",
    "- <steps or commands>",
    "",
    "## Applicability",
    "- <when it applies>",
    "",
    "Questions:",
    ...questions.map((q, idx) => `${idx + 1}) ${q}`)
  ].join("\n")
}

export async function runAgentHiro(
  input: AgentHiroInput,
  callbacks?: {
    onEvent?: (event: { type: string; [key: string]: unknown }) => void
    shouldStop?: () => boolean
  }
) {
  const workspace = await getDBWorkspace({ id: input.workspace_id })
  if (!workspace) throw new AppError("NOT_FOUND", "Workspace not found", { workspace_id: input.workspace_id })
  const workspacePath = workspace.path

  const readFileTool = createReadFileTool(input.workspace_id)
  const writeFileTool = createWriteFileTool(input.workspace_id)
  const appendKnowledgeTool = createAppendKnowledgeTool(input.workspace_id)
  const stateTool = createStateTool(input.workspace_id)
  const shellTool = createShellTool(input.workspace_id)

  const savedState = await readAgentState(workspacePath)
  const agent = new ToolLoopAgent({
    model: input.model,
    instruction: buildHiroPrompt(input.questions),
    tools: [
      websearch,
      fetchMarkdown,
      ghSearchRepos,
      ghSearchCode,
      ghGetContent,
      ghListReleases,
      ghListSecurityAdvisories,
      readFileTool,
      writeFileTool,
      appendKnowledgeTool,
      stateTool,
      shellTool
    ],
    initialContext: savedState?.context,
    onEvent: callbacks?.onEvent,
    onStepEnd: async ({ stop }) => {
      const shouldStop = callbacks?.shouldStop?.() ?? false
      const status = shouldStop ? "paused" : "running"
      if (shouldStop) stop()
      await writeAgentState(workspacePath, {
        version: 1,
        context: agent.context,
        step_count: agent.stepCount,
        status,
        last_agent: "AgentHiro",
        updated_at: new Date().toISOString()
      })
    }
  })

  const store = (workspace.store as WorkspaceStore | null) ?? null
  await updateDBWorkspace({
    id: input.workspace_id,
    data: {
      store: {
        ...(store ?? {}),
        status: "blocked",
        current_step: "hiro_research"
      }
    }
  })

  await writeAgentState(workspacePath, {
    version: 1,
    context: savedState?.context ?? [],
    step_count: savedState?.step_count ?? 0,
    status: "running",
    last_agent: "AgentHiro",
    updated_at: new Date().toISOString()
  })

  await agent.generate({
    prompt:
      "Begin research. Write report to knowledges/ using the template and call appendKnowledge with id/title/summary/source/path."
  })
}
