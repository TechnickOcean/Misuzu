import * as path from "node:path"
import { TMP_DIR } from "@/consts"
import { createWorkspace, updateWorkspaceConfig } from "@/tools/workspace/core/manager"
import {
  copyAttachments,
  type EnvironmentInfo,
  ensureWorkspaceLayout,
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
  workspace_id: string
  workspace_path: string
}

export async function runEnvAgent(input: EnvAgentInput): Promise<EnvAgentResult> {
  const workspaceRow = await createWorkspace({ title: input.title, id: input.workspace_dir_name })
  const workspace_id = workspaceRow.id

  const basePath = workspaceRow.path
  const rootDirName = path.basename(basePath)
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

  await updateWorkspaceConfig({ id: workspace_id, data: { path: workspace_path } })

  return { workspace_id, workspace_path }
}
