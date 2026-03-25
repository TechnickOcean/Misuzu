import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, resolve, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

/**
 * Skill system — implements https://agentskills.io specification.
 * Misuzu does not check the security of input skills, install with caution.
 */

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  "allowed-tools"?: string;
  [key: string]: unknown;
}

export interface Skill {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  body: string;
  allowedTools: string[];
}

export function extractSkillFrontmatter(content: string): {
  frontmatter: SkillFrontmatter;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  try {
    const frontmatter = parseYaml(match[1]) as SkillFrontmatter;
    return { frontmatter: frontmatter ?? {}, body: match[2] };
  } catch {
    console.warn("Failed to parse skill frontmatter, loading as plain content");
    return { frontmatter: {}, body: match[2] };
  }
}

export async function importSkillsFromDirectory(dir: string): Promise<Skill[]> {
  const resolvedDir = resolve(dir);
  if (!existsSync(resolvedDir)) return [];

  const skills: Skill[] = [];
  const seen = new Set<string>();

  // If root dir has SKILL.md, treat as single skill (don't recurse)
  const rootSkill = join(resolvedDir, "SKILL.md");
  if (existsSync(rootSkill)) {
    const skill = loadSkill(rootSkill);
    if (skill) skills.push(skill);
    return skills;
  }

  // Otherwise, recurse into subdirectories
  const entries = readdirSync(resolvedDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules")
      continue;

    const skillFile = join(resolvedDir, entry.name, "SKILL.md");
    if (!existsSync(skillFile)) continue;

    try {
      const realPath = statSync(skillFile).isSymbolicLink()
        ? require("node:fs").realpathSync(skillFile)
        : skillFile;
      if (seen.has(realPath)) continue;
      seen.add(realPath);
    } catch {
      continue;
    }

    const skill = loadSkill(skillFile);
    if (skill) skills.push(skill);
  }

  return skills;
}

function loadSkill(filePath: string): Skill | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    const { frontmatter, body } = extractSkillFrontmatter(content);
    const baseDir = join(filePath, "..");

    const name = frontmatter.name ?? basename(baseDir);
    const description = frontmatter.description ?? "";
    const allowedTools = frontmatter["allowed-tools"]
      ? frontmatter["allowed-tools"].split(",").map((s) => s.trim())
      : [];

    return { name, description, filePath, baseDir, body, allowedTools };
  } catch {
    console.warn(`Failed to load skill: ${filePath}`);
    return null;
  }
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildSkillsCatalog(skills: Skill[]): string {
  if (skills.length === 0) return "";

  const lines = [
    "\nThe following skills provide specialized instructions for specific tasks.",
    "Use the read tool to load a skill's file when the task matches its description.",
    "",
    "<available_skills>",
  ];

  for (const skill of skills) {
    lines.push("  <skill>");
    lines.push(`    <name>${escapeXml(skill.name)}</name>`);
    lines.push(`    <description>${escapeXml(skill.description)}</description>`);
    lines.push(`    <location>${escapeXml(skill.filePath)}</location>`);
    lines.push("  </skill>");
  }

  lines.push("</available_skills>");
  return lines.join("\n");
}

/** Synchronously load skills from a directory (no async needed since all fs ops are sync). */
export function importSkillsFromDirectorySync(dir: string): Skill[] {
  const resolvedDir = resolve(dir);
  if (!existsSync(resolvedDir)) return [];

  // If root dir has SKILL.md, treat as single skill
  const rootSkill = join(resolvedDir, "SKILL.md");
  if (existsSync(rootSkill)) {
    const skill = loadSkill(rootSkill);
    return skill ? [skill] : [];
  }

  // Recurse into subdirectories
  const skills: Skill[] = [];
  const seen = new Set<string>();

  for (const entry of readdirSync(resolvedDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules")
      continue;
    const skillFile = join(resolvedDir, entry.name, "SKILL.md");
    if (!existsSync(skillFile)) continue;
    try {
      const realPath = statSync(skillFile).isSymbolicLink()
        ? require("node:fs").realpathSync(skillFile)
        : skillFile;
      if (seen.has(realPath)) continue;
      seen.add(realPath);
    } catch {
      continue;
    }
    const skill = loadSkill(skillFile);
    if (skill) skills.push(skill);
  }

  return skills;
}

/** Load built-in skills from the package's builtins/skills directory. */
export function loadBuiltinSkills(): Skill[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const skillsDir = join(here, "..", "builtins", "skills");
  return importSkillsFromDirectorySync(skillsDir);
}
