import type { ChatCompletionMessageParam } from "openai/resources"
import * as z from "zod"
import { runAgentHiro } from "@/agents/AgentHiro"
import { readAgentState, writeAgentState } from "@/agents/base/agentState"
import ToolLoopAgent from "@/agents/base/ToolLoopAgent"
import BaseFunctionTool from "@/tools/base/FunctionTool"
import { getWorkspace } from "@/tools/workspace/core/manager"
import { ShellManager } from "@/tools/workspace/shell_manager"
import {
  createGlobTool,
  createGrepTool,
  createReadFileTool,
  createShellSessionTools,
  createShellTool,
  createWriteFileTool
} from "@/tools/workspace/workspace"

export interface CTFAgentInput {
  workspace_id: string
  model: "glm-4.7-flash" | "llama-4-scout-17b-16e-instruct" | "qwen3-30b-a3b-fp8"
}

const CTF_COMPACT_PROMPT = `You are summarizing the state of a CTF-solving agent for later restoration.
Return ONLY the summary. Be concise but preserve critical technical details.

Include:
- Objective and challenge type (white/black/gray) + remote URL (if any).
- Key artifacts: paths, filenames, and noteworthy snippets/IOCs.
- Steps already tried, tools/commands executed, and their outcomes.
- Current hypothesis/attack path and blockers.
- Pending tasks or next commands to run.
- Any temp services/ports started locally and credentials/secrets found.
`

function buildContextPrompt(envMd: string, fileTree: string) {
  return [
    "你是 CTF Agent，一个身经百战的 CTFer。你的任务是接受用户提供的 CTF 挑战题目，并尝试一步一步地解决它，获得 flag。",

    "你应当遵循：收集信息 -> 尝试利用已有知识解题 -> 若失败，简短**反思**后继续解题 的循环。",

    "关于“信息”的第一来源应当是用户提供的附件，对于白盒题目，你应当第一时间分析附件，仔细审计源码中潜在的漏洞；",
    "对于黑/灰盒题目，你应当使用 curl, nc 等命令行工具去收集用户提供远程环境 URL 暴露的信息。",
    "在你卡在某一环节一段时间，认为自己需要补充相关知识(语法点/CVE...)或需要搜索互联网，你可以详细地描述你的问题，使用 requestHiroTool 提供给安全专家 AgentHiro，她会尽全力为你解惑；",
    "这些问题应当是具体到点的而非泛化的，你可以引用题目源码的段落，AgentHiro 与你分享一个工作空间。",

    "你应当积极地利用工具(python 脚本、curl...)做出具体的解题尝试而不是空思考。",
    "对于黑盒题目，若无明确说明，请不要爆破或扫描远程环境；",
    "对于提供了源码的白盒题目，你应当总是使用 terminal 在本地 background 启动测试环境，",
    "在本地成功攻击，取得测试 flag 后再将你的 exp 运行于远程环境。（若附件为压缩包，你可以使用 python 的 zipfile 解压）",
    "",
    "## Environment",
    envMd,
    "",
    "## Workspace Files",
    fileTree || "(empty)"
  ].join("\n")
}

export async function runCTFAgent(
  input: CTFAgentInput,
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
  const globTool = createGlobTool(input.workspace_id)
  const grepTool = createGrepTool(input.workspace_id)
  const shellTool = createShellTool(input.workspace_id)
  const tagEvent = (agentName: string) => (event: { type: string; [key: string]: unknown }) => {
    callbacks?.onEvent?.({
      ...event,
      agent: agentName,
      timestamp: new Date().toISOString()
    })
  }
  const shellManager = new ShellManager(workspacePath, tagEvent("CTFAgent"))
  const shellSessionTools = createShellSessionTools(shellManager)

  const requestHiroTool = new BaseFunctionTool({
    name: "request_agent_hiro",
    description: "Request AgentHiro research for missing knowledge and wait for its report.",
    schema: z.object({
      questions: z.optional(z.array(z.string())).meta({ description: "Questions for AgentHiro to research." }),
      reason: z.optional(z.string()).meta({ description: "Short reason for requesting AgentHiro." })
    }),
    func: async ({ questions, reason }: { questions?: string[]; reason?: string }) => {
      const list = (questions ?? [])
        .map((q) => q.trim())
        .filter(Boolean)
        .slice(0, 5)
      const fallback = reason?.trim() ? [reason.trim()] : []
      const payload = list.length ? list : fallback.length ? fallback : ["Provide missing knowledge."]
      await runAgentHiro(
        {
          workspace_id: input.workspace_id,
          model: input.model,
          questions: payload
        },
        {
          ...callbacks,
          onEvent: tagEvent("AgentHiro")
        }
      )
      await writeAgentState(workspacePath, {
        context: agent.context,
        step_count: agent.stepCount,
        status: "running",
        last_agent: "CTFAgent",
        updated_at: new Date().toISOString()
      })
      return "AgentHiro completed"
    }
  })

  const envMd = await readFileTool.execute(JSON.stringify({ file_path: "Environment.md" }))
  const fileTree = await globTool.execute(JSON.stringify({ pattern: "**/*" }))

  const prompt = buildContextPrompt(JSON.parse(envMd), JSON.parse(fileTree))
  const savedState = await readAgentState(workspacePath)

  await writeAgentState(workspacePath, {
    context: savedState?.context ?? [],
    step_count: savedState?.step_count ?? 0,
    status: "running",
    last_agent: "CTFAgent",
    updated_at: new Date().toISOString()
  })

  const agent = new ToolLoopAgent({
    model: input.model,
    instruction: prompt,
    tools: [readFileTool, writeFileTool, globTool, grepTool, shellTool, requestHiroTool, ...shellSessionTools],
    initialContext: savedState?.context,
    onEvent: tagEvent("CTFAgent"),
    onStepEnd: async ({ stop, APIResponse, stopReason }) => {
      const shouldStop = callbacks?.shouldStop?.() ?? false
      const finished = !shouldStop && isFinalStop(APIResponse)
      const status = shouldStop
        ? "paused"
        : stopReason === "max_steps"
          ? "max_steps"
          : stopReason === "content_filter"
            ? "filtered"
            : finished
              ? "done"
              : "running"
      if (shouldStop) stop()
      await writeAgentState(workspacePath, {
        context: agent.context,
        step_count: agent.stepCount,
        status,
        last_agent: "CTFAgent",
        updated_at: new Date().toISOString()
      })
      void finished
    }
  })

  try {
    await agent.generate({
      prompt:
        "Start solving." +
        "If you obtain the final flag, write the exploit script to solution/ and update WriteUp.md with reproducible steps."
    })
  } finally {
    shellManager.closeAll()
  }
}

export async function pauseCTFAgent(input: { workspace_id: string }) {
  const workspace = await getWorkspace({ id: input.workspace_id })
  const workspacePath = workspace.path
  const savedState = await readAgentState(workspacePath)
  await writeAgentState(workspacePath, {
    context: savedState?.context ?? [],
    step_count: savedState?.step_count ?? 0,
    status: "paused",
    last_agent: savedState?.last_agent ?? "CTFAgent",
    updated_at: new Date().toISOString()
  })
  return { ok: true }
}

export async function addCTFConversation(input: { workspace_id: string; prompt: string }) {
  const workspace = await getWorkspace({ id: input.workspace_id })
  const workspacePath = workspace.path
  const savedState = await readAgentState(workspacePath)
  const nextContext = [
    ...(savedState?.context ?? []),
    { role: "user", content: input.prompt } as ChatCompletionMessageParam
  ]
  await writeAgentState(workspacePath, {
    context: nextContext,
    step_count: 0,
    status: "running",
    last_agent: "CTFAgent",
    updated_at: new Date().toISOString()
  })
  return { ok: true }
}

export async function compactCTFContext(input: { workspace_id: string; model: CTFAgentInput["model"] }) {
  const workspace = await getWorkspace({ id: input.workspace_id })
  const workspacePath = workspace.path
  const savedState = await readAgentState(workspacePath)
  const agent = new ToolLoopAgent({
    model: input.model,
    instruction: buildContextPrompt("", ""),
    tools: [],
    initialContext: savedState?.context
  })
  await agent.compactWithPrompt(CTF_COMPACT_PROMPT)
  await writeAgentState(workspacePath, {
    context: agent.context,
    step_count: 0,
    status: "paused",
    last_agent: "CTFAgent",
    updated_at: new Date().toISOString()
  })
  return { ok: true }
}
