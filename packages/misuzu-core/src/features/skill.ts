import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parse as parseYaml } from "yaml"

/**
 * Skill system — implements https://agentskills.io specification.
 * Misuzu does not check the security of input skills, install with caution.
 */

export interface SkillFrontmatter {
  name?: string
  description?: string
  "allowed-tools"?: string
  [key: string]: unknown
}

export type SkillRole = "shared" | "solver" | "coordinator"

export interface Skill {
  name: string
  description: string
  filePath: string
  baseDir: string
  body: string
  allowedTools: string[]
}

export interface AgentSkillLoadOptions {
  role: Exclude<SkillRole, "shared">
  launchDir?: string
  misuzuRoot?: string
  extraSkills?: Skill[]
}

const BUILTIN_SKILLS_RELATIVE_PATH = join(".misuzu", "skills")
const WORKSPACE_MARKERS = [".misuzu", ".mizusu"]

function toComparablePath(path: string): string {
  return resolve(path).toLowerCase()
}

function mergeSkillsByName(...groups: Skill[][]): Skill[] {
  const merged: Skill[] = []
  const byName = new Map<string, number>()

  for (const group of groups) {
    for (const skill of group) {
      const existingIndex = byName.get(skill.name)
      if (existingIndex === undefined) {
        byName.set(skill.name, merged.length)
        merged.push(skill)
      } else {
        merged[existingIndex] = skill
      }
    }
  }

  return merged
}

export function extractSkillFrontmatter(content: string): {
  frontmatter: SkillFrontmatter
  body: string
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) {
    return { frontmatter: {}, body: content }
  }

  try {
    const frontmatter = parseYaml(match[1]) as SkillFrontmatter
    return { frontmatter: frontmatter ?? {}, body: match[2] }
  } catch {
    console.warn("Failed to parse skill frontmatter, loading as plain content")
    return { frontmatter: {}, body: match[2] }
  }
}

function loadSkill(filePath: string): Skill | null {
  try {
    const content = readFileSync(filePath, "utf-8")
    const { frontmatter, body } = extractSkillFrontmatter(content)
    const baseDir = dirname(filePath)

    const name = frontmatter.name ?? basename(baseDir)
    const description = frontmatter.description ?? ""
    const allowedTools = frontmatter["allowed-tools"]
      ? frontmatter["allowed-tools"].split(",").map((s) => s.trim())
      : []

    return { name, description, filePath, baseDir, body, allowedTools }
  } catch {
    console.warn(`Failed to load skill: ${filePath}`)
    return null
  }
}

export async function importSkillsFromDirectory(dir: string): Promise<Skill[]> {
  return importSkillsFromDirectorySync(dir)
}

/** Synchronously load skills from a directory. */
export function importSkillsFromDirectorySync(dir: string): Skill[] {
  const resolvedDir = resolve(dir)
  if (!existsSync(resolvedDir)) return []

  // If root dir has SKILL.md, treat as single skill.
  const rootSkill = join(resolvedDir, "SKILL.md")
  if (existsSync(rootSkill)) {
    const skill = loadSkill(rootSkill)
    return skill ? [skill] : []
  }

  const skills: Skill[] = []
  const seen = new Set<string>()

  for (const entry of readdirSync(resolvedDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") {
      continue
    }

    const skillFile = join(resolvedDir, entry.name, "SKILL.md")
    if (!existsSync(skillFile)) continue

    try {
      const realPath = statSync(skillFile).isSymbolicLink() ? realpathSync(skillFile) : skillFile
      if (seen.has(realPath)) continue
      seen.add(realPath)
    } catch {
      continue
    }

    const skill = loadSkill(skillFile)
    if (skill) skills.push(skill)
  }

  return skills
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

export function buildSkillsCatalog(skills: Skill[]): string {
  if (skills.length === 0) return ""

  const lines = [
    "\nThe following skills provide specialized instructions for specific tasks.",
    "Use the read tool to load a skill's file when the task matches its description.",
    "",
    "<available_skills>",
  ]

  for (const skill of skills) {
    lines.push("  <skill>")
    lines.push(`    <name>${escapeXml(skill.name)}</name>`)
    lines.push(`    <description>${escapeXml(skill.description)}</description>`)
    lines.push(`    <location>${escapeXml(skill.filePath)}</location>`)
    lines.push("  </skill>")
  }

  lines.push("</available_skills>")
  return lines.join("\n")
}

export function resolveMisuzuRoot(
  startDir: string = dirname(fileURLToPath(import.meta.url)),
): string | undefined {
  let current = resolve(startDir)

  while (true) {
    const builtinSkillsDir = join(current, BUILTIN_SKILLS_RELATIVE_PATH)
    if (existsSync(builtinSkillsDir)) {
      return current
    }

    const parent = dirname(current)
    if (parent === current) {
      return undefined
    }

    current = parent
  }
}

function collectRoleSkills(skillsRoot: string, role: Exclude<SkillRole, "shared">): Skill[] {
  return [
    ...importSkillsFromDirectorySync(join(skillsRoot, "shared")),
    ...importSkillsFromDirectorySync(join(skillsRoot, role)),
  ]
}

function resolveWorkspaceSkillsRoot(launchDir: string): string | undefined {
  const resolvedLaunch = resolve(launchDir)

  for (const marker of WORKSPACE_MARKERS) {
    const markerDir = join(resolvedLaunch, marker)
    if (existsSync(markerDir)) {
      return join(markerDir, "skills")
    }
  }

  return undefined
}

export function loadBuiltinSkills(
  role: Exclude<SkillRole, "shared">,
  misuzuRoot: string | undefined = resolveMisuzuRoot(),
): Skill[] {
  if (!misuzuRoot) return []
  const builtinSkillsRoot = join(misuzuRoot, BUILTIN_SKILLS_RELATIVE_PATH)
  return collectRoleSkills(builtinSkillsRoot, role)
}

export function loadWorkspaceSkills(
  role: Exclude<SkillRole, "shared">,
  launchDir: string,
  misuzuRoot: string | undefined = resolveMisuzuRoot(),
): Skill[] {
  const resolvedLaunch = resolve(launchDir)

  // Workspace skills only apply when CLI is not started from Misuzu root.
  if (misuzuRoot && toComparablePath(misuzuRoot) === toComparablePath(resolvedLaunch)) {
    return []
  }

  const workspaceSkillsRoot = resolveWorkspaceSkillsRoot(resolvedLaunch)
  if (!workspaceSkillsRoot) return []

  return collectRoleSkills(workspaceSkillsRoot, role)
}

export function loadAgentSkills(options: AgentSkillLoadOptions): Skill[] {
  const launchDir = options.launchDir ?? process.cwd()
  const misuzuRoot = options.misuzuRoot ?? resolveMisuzuRoot()
  const builtinSkills = loadBuiltinSkills(options.role, misuzuRoot)
  const workspaceSkills = loadWorkspaceSkills(options.role, launchDir, misuzuRoot)
  const extraSkills = options.extraSkills ?? []

  return mergeSkillsByName(builtinSkills, workspaceSkills, extraSkills)
}
