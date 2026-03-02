import * as path from "node:path"
import { TMP_DIR } from "@/consts"
import { createDBWorkspace, getDBWorkspace, updateDBWorkspace } from "@/tools/workspace/core/db"
import {
  copyAttachments,
  type EnvironmentInfo,
  ensureWorkspaceLayout,
  initWorkspaceStore,
  writeEnvironmentMd
} from "@/tools/workspace/helpers"

export interface EnvAgentInput {
  title: string
  description: string
  hints?: string[]
  remote_url?: string | null
  attachments?: string[]
  workspace_dir_name?: string
}

export interface EnvAgentResult {
  workspace_id: number
  workspace_path: string
}

export async function runEnvAgent(input: EnvAgentInput): Promise<EnvAgentResult> {
  const workspaceRow = await createDBWorkspace({ title: input.title })
  const workspace_id = workspaceRow[0]?.id
  if (!workspace_id) throw new Error("Failed to create workspace")

  const workspace = await getDBWorkspace({ id: workspace_id })
  if (!workspace) throw new Error("Workspace not found after creation")
  const basePath = workspace.path

  const rootDirName = input.workspace_dir_name ?? path.basename(basePath)
  const workspace_path = path.join(TMP_DIR, rootDirName)

  await ensureWorkspaceLayout(workspace_path)

  const copiedAttachments = input.attachments?.length ? await copyAttachments(workspace_path, input.attachments) : []

  const envInfo: EnvironmentInfo = {
    title: input.title,
    description: input.description,
    remote_url: input.remote_url ?? null,
    hints: input.hints ?? [],
    attachments: copiedAttachments
  }

  await writeEnvironmentMd(workspace_path, envInfo)

  const store = initWorkspaceStore(envInfo)
  await updateDBWorkspace({ id: workspace_id, data: { path: workspace_path, store } })

  return { workspace_id, workspace_path }
}
