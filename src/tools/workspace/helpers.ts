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

export async function ensureWorkspaceLayout(rootPath: string) {
  await fs.mkdir(rootPath, { recursive: true })
  const dirs = ["challenge", "knowledges", "solution"]
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
