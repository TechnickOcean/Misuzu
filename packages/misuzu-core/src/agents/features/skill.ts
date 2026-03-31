/**
 * Skill system — implements https://agentskills.io specification.
 * Misuzu does not check the security of input skills, install with caution.
 */

import { readdirSync, readFileSync, realpathSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { parse as parseYaml } from "yaml"
import { resolveMisuzuRoot } from "../../utils/path.ts"
import { resolveWorkspacePaths } from "../../core/application/workspace/paths.ts"

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
  role: SkillRole
  launchDir?: string
  misuzuRoot?: string
  extraSkills?: Skill[]
}

const BUILTIN_SKILLS_RELATIVE_PATH = join(".misuzu", "skills")

function escapeXml(str: string) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function extractSkillFrontmatter(content: string) {
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

function collectRoleSkills(skillsRoot: string, role: SkillRole) {
  if (role === "shared") return importSkillsFromDirectory(join(skillsRoot, "shared"))
  else
    return [
      ...importSkillsFromDirectory(join(skillsRoot, "shared")),
      ...importSkillsFromDirectory(join(skillsRoot, role)),
    ]
}

/** load skills from a skill/ directory. */
function importSkillsFromDirectory(dir: string) {
  try {
    const resolvedDir = resolve(dir)

    const skills: Skill[] = []
    const seen = new Set<string>()

    for (const entry of readdirSync(resolvedDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) {
        continue
      }

      const skillFile = join(resolvedDir, entry.name, "SKILL.md")
      let realPath: string
      try {
        realPath = realpathSync(skillFile)
      } catch {
        continue
      }

      if (seen.has(realPath)) continue
      seen.add(realPath)

      const skill = loadSkill(skillFile)
      if (skill) skills.push(skill)
    }
    return skills
  } catch {
    return []
  }
}

export function loadBuiltinSkills(role: SkillRole, misuzuRoot = resolveMisuzuRoot()) {
  if (!misuzuRoot) return []
  const builtinSkillsRoot = join(misuzuRoot, BUILTIN_SKILLS_RELATIVE_PATH)
  return collectRoleSkills(builtinSkillsRoot, role)
}

export function loadWorkspaceSkills(role: SkillRole, workspaceRootDir: string) {
  const paths = resolveWorkspacePaths(workspaceRootDir)
  return collectRoleSkills(paths.skillsRootDir, role)
}

export function loadAgentSkills(options: AgentSkillLoadOptions) {
  const launchDir = options.launchDir ?? process.cwd()
  const misuzuRoot = options.misuzuRoot ?? resolveMisuzuRoot()
  const builtinSkills = loadBuiltinSkills(options.role, misuzuRoot)
  const workspaceSkills = loadWorkspaceSkills(options.role, launchDir)
  const extraSkills = options.extraSkills ?? []

  return mergeSkillsByName(builtinSkills, workspaceSkills, extraSkills)
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
