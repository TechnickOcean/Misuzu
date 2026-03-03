import * as z from "zod"
import { runAgentHiro } from "@/agents/AgentHiro"
import { readAgentState, writeAgentState } from "@/agents/base/agentState"
import ToolLoopAgent from "@/agents/base/ToolLoopAgent"
import BaseFunctionTool from "@/tools/base/FunctionTool"
import { getDBWorkspace, updateDBWorkspace } from "@/tools/workspace/core/db"
import type { WorkspaceStore } from "@/tools/workspace/helpers"
import { ShellManager } from "@/tools/workspace/shell_manager"
import {
  createGlobTool,
  createGrepTool,
  createReadFileTool,
  createShellSessionTools,
  createShellTool,
  createStateTool,
  createWriteFileTool
} from "@/tools/workspace/workspace"
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
    "Follow the OODA loop: Observe -> Orient -> Decide -> Act.",
    "Use tools to inspect files, run commands, and gather evidence.",
    "Workspace tools are already scoped to the current workspace.",
    "Use multi-terminal tools for persistent sessions: create_terminal -> exec_terminal. `cd` persists per session.",
    "Use background mode for long-running tasks. read_terminal shows recent output, kill_terminal stops it.",
    "Use the legacy `shell` tool for quick, one-off commands with no persistent state.",
    "If you need external knowledge, call request_agent_hiro with questions.",
    "If stuck for 3 steps without progress, request AgentHiro.",
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

export async function runCTFAgent(
  input: CTFAgentInput,
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
  const globTool = createGlobTool(input.workspace_id)
  const grepTool = createGrepTool(input.workspace_id)
  const shellTool = createShellTool(input.workspace_id)
  const stateTool = createStateTool(input.workspace_id)
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
        version: 1,
        context: agent.context,
        step_count: agent.stepCount,
        status: "running",
        last_agent: "CTFAgent",
        updated_at: new Date().toISOString()
      })
      const refreshed = await getDBWorkspace({ id: input.workspace_id })
      const store = (refreshed?.store as WorkspaceStore | null) ?? null
      const latest = store?.knowledge_index?.slice(-1)[0]
      if (latest) {
        return `AgentHiro report: ${latest.title} (${latest.path})`
      }
      return "AgentHiro completed without knowledge report"
    }
  })

  const envMd = await readFileTool.execute(JSON.stringify({ file_path: "Environment.md" }))
  const fileTree = await globTool.execute(JSON.stringify({ pattern: "**/*" }))

  const store = (workspace.store as WorkspaceStore | null) ?? null
  const prompt = buildContextPrompt(store, JSON.parse(envMd), JSON.parse(fileTree))
  const savedState = await readAgentState(workspacePath)

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

  await writeAgentState(workspacePath, {
    version: 1,
    context: savedState?.context ?? [],
    step_count: savedState?.step_count ?? 0,
    status: "running",
    last_agent: "CTFAgent",
    updated_at: new Date().toISOString()
  })

  const agent = new ToolLoopAgent({
    model: input.model,
    instruction: prompt,
    tools: [
      readFileTool,
      writeFileTool,
      globTool,
      grepTool,
      shellTool,
      stateTool,
      requestHiroTool,
      ...shellSessionTools
    ],
    initialContext: savedState?.context,
    onEvent: tagEvent("CTFAgent"),
    onStepEnd: async ({ stop }) => {
      const shouldStop = callbacks?.shouldStop?.() ?? false
      const status = shouldStop ? "paused" : "running"
      if (shouldStop) stop()
      await writeAgentState(workspacePath, {
        version: 1,
        context: agent.context,
        step_count: agent.stepCount,
        status,
        last_agent: "CTFAgent",
        updated_at: new Date().toISOString()
      })
    }
  })

  try {
    await agent.generate({
      prompt:
        "Start solving. If you need external knowledge, stop and ask for AgentHiro. " +
        "If you obtain the final flag, write the exploit script to solution/ and update WriteUp.md with reproducible steps."
    })
  } finally {
    shellManager.closeAll()
  }
}
