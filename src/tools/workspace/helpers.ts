import * as fs from "node:fs/promises"
import * as path from "node:path"
import { AppError } from "@/utils/errors"

export interface EnvironmentInfo {
  title: string
  description: string
  remote_url?: string | null
  hints?: string[]
  attachments?: string[]
}

export interface WorkspaceStore {
  status: "idle" | "running" | "blocked" | "done" | "failed"
  current_step: string
  progress: Array<{ ts: string; agent: string; event: string }>
  findings: Array<{ id: string; summary: string; artifacts: string[]; ts: string }>
  knowledge_index: Array<{ id: string; title: string; summary: string; source: string; path: string }>
  environment: {
    remote_url: string | null
    title: string
    description: string
    hints: string[]
    attachments: string[]
  }
}

export function appendProgress(store: WorkspaceStore, agent: string, event: string) {
  const next = { ...store }
  next.progress = [...store.progress, { ts: new Date().toISOString(), agent, event }]
  return next
}

export function updateStatus(store: WorkspaceStore, status: WorkspaceStore["status"], step: string) {
  return { ...store, status, current_step: step }
}

export function addKnowledge(
  store: WorkspaceStore,
  entry: { id: string; title: string; summary: string; source: string; path: string }
) {
  return { ...store, knowledge_index: [...store.knowledge_index, entry] }
}

export async function ensureWorkspaceLayout(rootPath: string) {
  await fs.mkdir(rootPath, { recursive: true })
  const dirs = ["challenge", "knowledges", "solution", "logs"]
  for (const dir of dirs) {
    await fs.mkdir(path.join(rootPath, dir), { recursive: true })
  }
}

export function buildEnvironmentMd(info: EnvironmentInfo) {
  const hints = info.hints ?? []
  const attachments = info.attachments ?? []
  const remoteUrl = info.remote_url ?? "none"

  const hintLines = hints.length ? hints.map((hint) => `- ${hint}`).join("\n") : "- none"
  const attachmentLines = attachments.length ? attachments.map((file) => `- ${file}`).join("\n") : "- none"

  return [
    "# Environment",
    "",
    `Title: ${info.title}`,
    `Description: ${info.description}`,
    `Remote URL: ${remoteUrl}`,
    "",
    "## Hints",
    hintLines,
    "",
    "## Attachments",
    attachmentLines,
    ""
  ].join("\n")
}

export async function writeEnvironmentMd(rootPath: string, info: EnvironmentInfo) {
  const content = buildEnvironmentMd(info)
  await fs.writeFile(path.join(rootPath, "Environment.md"), content, "utf-8")
}

export async function copyAttachments(rootPath: string, attachments: string[]) {
  const destDir = path.join(rootPath, "challenge")
  const copied: string[] = []

  for (const attachment of attachments) {
    const fileName = path.basename(attachment)
    const destPath = path.join(destDir, fileName)
    try {
      await fs.copyFile(attachment, destPath)
    } catch {
      throw new AppError("NOT_FOUND", "Attachment not found", { attachment })
    }
    copied.push(path.join("challenge", fileName))
  }

  return copied
}

export function initWorkspaceStore(info: EnvironmentInfo): WorkspaceStore {
  const now = new Date().toISOString()
  return {
    status: "idle",
    current_step: "env_ready",
    progress: [{ ts: now, agent: "EnvAgent", event: "environment initialized" }],
    findings: [],
    knowledge_index: [],
    environment: {
      remote_url: info.remote_url ?? null,
      title: info.title,
      description: info.description,
      hints: info.hints ?? [],
      attachments: info.attachments ?? []
    }
  }
}
