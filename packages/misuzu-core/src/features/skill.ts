/**
 * Skill system — implements https://agentskills.io specification.
 * Misuzu does not check the security of input skills, install with caution.
 */

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parse as parseYaml } from "yaml"

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

const WORKSPACE_MARKER = ".misuzu"
const BUILTIN_SKILLS_RELATIVE_PATH = join(WORKSPACE_MARKER, "skills")

function toComparablePath(path: string) {
  return resolve(path).toLowerCase()
}

// TODO: bad algo, fixme
export function resolveMisuzuRoot(startDir = dirname(fileURLToPath(import.meta.url))) {
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

function escapeXml(str: string) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function mergeSkillsByName(...groups: Skill[][]) {
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

export function buildSkillsCatalog(skills: Skill[]) {
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

export function extractSkillFrontmatter(content: string) {
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

function loadSkill(filePath: string) {
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

/** load skills from a directory. */
export async function importSkillsFromDirectory(dir: string) {
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
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
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

async function collectRoleSkills(skillsRoot: string, role: Exclude<SkillRole, "shared">) {
  return [
    ...(await importSkillsFromDirectory(join(skillsRoot, "shared"))),
    ...(await importSkillsFromDirectory(join(skillsRoot, role))),
  ]
}

export function loadBuiltinSkills(
  role: Exclude<SkillRole, "shared">,
  misuzuRoot: string | undefined = resolveMisuzuRoot(),
) {
  if (!misuzuRoot) return []
  const builtinSkillsRoot = join(misuzuRoot, BUILTIN_SKILLS_RELATIVE_PATH)
  return collectRoleSkills(builtinSkillsRoot, role)
}

export function loadWorkspaceSkills(
  role: Exclude<SkillRole, "shared">,
  launchDir: string,
  misuzuRoot: string | undefined = resolveMisuzuRoot(),
) {
  const resolvedLaunch = resolve(launchDir)
  if (misuzuRoot && toComparablePath(misuzuRoot) === toComparablePath(resolvedLaunch)) {
    return []
  }
  const markerDir = join(resolvedLaunch, WORKSPACE_MARKER)
  if (existsSync(markerDir)) {
    return collectRoleSkills(join(markerDir, "skills"), role)
  } else {
    return []
  }
}

export async function loadAgentSkills(options: AgentSkillLoadOptions) {
  const launchDir = options.launchDir ?? process.cwd()
  const misuzuRoot = options.misuzuRoot ?? resolveMisuzuRoot()
  const builtinSkills = await loadBuiltinSkills(options.role, misuzuRoot)
  const workspaceSkills = await loadWorkspaceSkills(options.role, launchDir, misuzuRoot)
  const extraSkills = options.extraSkills ?? []

  return mergeSkillsByName(builtinSkills, workspaceSkills, extraSkills)
}
