import ToolLoopAgent from "@/agents/base/ToolLoopAgent"
import {
  ghGetContent,
  ghListReleases,
  ghListSecurityAdvisories,
  ghSearchCode,
  ghSearchRepos
} from "@/tools/websearch/GitHubSearch"
import { fetchMarkdown, websearch } from "@/tools/websearch/WebSearch"
import { getDBWorkspace, updateDBWorkspace } from "@/tools/workspace/core/db"
import type { WorkspaceStore } from "@/tools/workspace/helpers"
import { appendKnowledgeTool, readFileTool, shellTool, stateTool, writeFileTool } from "@/tools/workspace/workspace"
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

export async function runAgentHiro(input: AgentHiroInput) {
  const workspace = await getDBWorkspace({ id: input.workspace_id })
  if (!workspace) throw new AppError("NOT_FOUND", "Workspace not found", { workspace_id: input.workspace_id })

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
    ]
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

  await agent.generate({
    prompt:
      "Begin research. Write report to knowledges/ using the template and call appendKnowledge with id/title/summary/source/path."
  })
}
