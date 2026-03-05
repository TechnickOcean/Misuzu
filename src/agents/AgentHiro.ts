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
import { getWorkspace } from "@/tools/workspace/core/manager"
import {
  createAppendKnowledgeTool,
  createReadFileTool,
  createShellTool,
  createWriteFileTool
} from "@/tools/workspace/workspace"

export interface AgentHiroInput {
  workspace_id: string
  model: "glm-4.7-flash" | "llama-4-scout-17b-16e-instruct" | "qwen3-30b-a3b-fp8"
  questions: string[]
}

function buildHiroPrompt(questions: string[]) {
  return [
    "你是 AgentHiro, 一个网络安全专家，你的任务是尽可能地帮助用户探索他的问题的解法。",

    "你可以利用网络搜索工具和你自身的知识，不过在你总结出结论之前，必须利用终端等本地工具尽可能对这些知识进行验证。",

    "你进行探索的思路是：先查询互联网资料，寻找可能有用的信息，结合自身知识将其实践运用到问题解决上。",

    "若你搜集的知识目前不足以解决问题，尝试猜测问题解决的方法，寻找新的灵感：对于利用方式可预见且有限的潜在利用点，你可以使用 fuzz(模糊测试) ，对于潜在的 0-day 风险，若你认为有必要，你可以 clone 对应版本的 lib 源码到本地进一步分析。",

    "当你认为你确实做足了所有尝试，仍然无法得出解决方案，你应当停止。",

    "无论是否得出结论，都请将本次探索的收获记录成清晰简洁可复现的 knowledge report (markdown) 到 knowledges/ 目录下，并使用 appendKnowledge tool 添加到知识库",

    "报告应当遵循以下格式",

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

    "Questions",
    "",
    ...questions.map((q, idx) => `${idx + 1}. ${q}`)
  ].join("\n")
}

export async function runAgentHiro(
  input: AgentHiroInput,
  callbacks?: {
    onEvent?: (event: { type: string; [key: string]: unknown }) => void
    shouldStop?: () => boolean
  }
) {
  const isFinalStop = (response?: { choices?: Array<{ finish_reason?: string }> }) =>
    Array.isArray(response?.choices) && response.choices.some((choice) => choice.finish_reason === "stop")
  const workspace = await getWorkspace({ id: input.workspace_id })
  const workspacePath = workspace.path

  const readFileTool = createReadFileTool(input.workspace_id)
  const writeFileTool = createWriteFileTool(input.workspace_id)
  const appendKnowledgeTool = createAppendKnowledgeTool(input.workspace_id)
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
      shellTool
    ],
    initialContext: savedState?.context,
    onEvent: callbacks?.onEvent,
    onStepEnd: async ({ stop, APIResponse }) => {
      const shouldStop = callbacks?.shouldStop?.() ?? false
      const finished = !shouldStop && isFinalStop(APIResponse)
      const status = shouldStop ? "paused" : finished ? "done" : "running"
      if (shouldStop) stop()
      await writeAgentState(workspacePath, {
        context: agent.context,
        step_count: agent.stepCount,
        status,
        last_agent: "AgentHiro",
        updated_at: new Date().toISOString()
      })
      void finished
    }
  })

  await writeAgentState(workspacePath, {
    context: savedState?.context ?? [],
    step_count: savedState?.step_count ?? 0,
    status: "running",
    last_agent: "AgentHiro",
    updated_at: new Date().toISOString()
  })

  await agent.generate({
    prompt: "开始你的探索。"
  })
}
