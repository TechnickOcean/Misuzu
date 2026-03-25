# Skills

Skills are self-contained capability packages that provide the agent with specialized workflows. Misuzu implements the [Agent Skills standard](https://agentskills.io/specification) with lenient validation.

> **Security:** Skills can instruct the model to perform any action. Misuzu does not check the security of input skills. Install with caution.

## Table of Contents

- [Overview](#overview)
- [How Skills Work](#how-skills-work)
- [Skill Structure](#skill-structure)
- [Frontmatter](#frontmatter)
- [Discovery](#discovery)
- [System Prompt Integration](#system-prompt-integration)
- [Built-in Skills](#built-in-skills)

## Overview

Skills provide progressive disclosure: only skill names and descriptions are always in context (in the system prompt). Full instructions load on-demand when the agent decides to use a skill.

```
System prompt (always in context):
┌────────────────────────────────────────────┐
│  You are a CTF solver agent...             │
│                                            │
│  <available_skills>                        │
│    <skill>                                 │
│      <name>agent-browser</name>            │  ← Name + description always visible
│      <description>Browser automation...</des│
│      <location>/path/to/SKILL.md</loc>     │  ← Path tells agent where to load
│    </skill>                                │
│  </available_skills>                       │
└────────────────────────────────────────────┘

When agent needs the skill:
  read("/path/to/SKILL.md")  ← Full instructions loaded on-demand
```

This keeps the context footprint minimal while providing access to arbitrarily large skill content.

## How Skills Work

1. At agent construction, misuzu scans skill directories for `SKILL.md` files
2. Names and descriptions are formatted as XML in the system prompt
3. When a task matches, the agent uses `read` to load the full `SKILL.md`
4. The agent follows the instructions, resolving relative paths against the skill's base directory

## Skill Structure

A skill is a directory containing a `SKILL.md` file:

```
agent-browser/
├── SKILL.md                    # Skill definition (required)
├── references/                 # Reference docs (optional)
│   ├── commands.md
│   └── authentication.md
└── templates/                  # Helper scripts (optional)
    └── form-automation.sh
```

### SKILL.md Format

```markdown
---
name: agent-browser
description: Browser automation CLI for AI agents. Use when the user needs
  to interact with websites.
allowed-tools: Bash(npx agent-browser:*), Bash(agent-browser:*)
---

# Browser Automation with agent-browser

The CLI uses Chrome/Chromium via CDP directly.

## Core Workflow

1. **Navigate**: `agent-browser open <url>`
2. **Snapshot**: `agent-browser snapshot -i`
3. **Interact**: Use refs to click, fill, select
   ...
```

## Frontmatter

YAML frontmatter is delimited by `---` fences at the start of `SKILL.md`.

### Fields

| Field                      | Required | Description                                                                                     |
| -------------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| `name`                     | No       | Skill identifier. Defaults to parent directory name. Max 64 chars, lowercase a-z, 0-9, hyphens. |
| `description`              | Yes      | One-line description of what the skill does. Max 1024 chars.                                    |
| `allowed-tools`            | No       | Tool restrictions (informational, not enforced by misuzu).                                      |
| `disable-model-invocation` | No       | If `true`, excluded from system prompt. Can only be invoked explicitly.                         |

### Lenient Validation

Misuzu warns about issues but still loads skills:

```typescript
// Description missing? Warning, but skill still loads.
if (!frontmatter.description) {
  diagnostics.push({ type: "warning", message: "description is required", path: filePath })
}

// Name doesn't match directory? Warning, directory name is used.
if (frontmatter.name !== parentDirName) {
  diagnostics.push({
    type: "warning",
    message: `name "${frontmatter.name}" does not match directory`,
  })
}
```

### Parsing

```typescript
import { parse } from "yaml"

export function extractSkillFrontmatter(content: string): {
  frontmatter: SkillFrontmatter
  body: string
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) {
    return { frontmatter: {}, body: content }
  }

  const frontmatter = parse(match[1]) as SkillFrontmatter
  const body = match[2]
  return { frontmatter, body }
}
```

## Discovery

### Directory Scanning

```typescript
export function importSkillsFromDirectory(dir: string): Skill[] {
  // 1. Check if dir contains SKILL.md → treat as skill root, don't recurse
  // 2. Otherwise, recurse into subdirectories looking for SKILL.md
  // 3. Respect .gitignore patterns
  // 4. Skip node_modules
  // 5. Detect symlink duplicates via realpathSync
}
```

### Loading Order

1. Scan the provided directory
2. Parse each `SKILL.md`'s frontmatter
3. Validate (lenient)
4. Deduplicate by `name` (first wins)
5. Deduplicate by `realpath` (symlink detection)
6. Return `Skill[]`

### Skill Interface

```typescript
export interface Skill {
  name: string // From frontmatter or directory name
  description: string // From frontmatter
  filePath: string // Absolute path to SKILL.md
  baseDir: string // Parent directory of SKILL.md
  body: string // Markdown content after frontmatter
  allowedTools: string[] // Parsed from allowed-tools frontmatter
}
```

## System Prompt Integration

Skills are formatted as XML in the system prompt. This is the only place skills appear in context — they are never stored as messages.

### Catalog Format

```xml
<available_skills>
  <skill>
    <name>agent-browser</name>
    <description>Browser automation CLI for AI agents...</description>
    <location>/absolute/path/to/SKILL.md</location>
  </skill>
  <skill>
    <name>forensics</name>
    <description>Disk image and memory analysis workflows</description>
    <location>/absolute/path/to/forensics/SKILL.md</location>
  </skill>
</available_skills>
```

### Building the Catalog

```typescript
export function buildSkillsCatalog(skills: Skill[]): string {
  const visibleSkills = skills.filter((s) => !s.disableModelInvocation)

  if (visibleSkills.length === 0) return ""

  const lines = [
    "\nThe following skills provide specialized instructions for specific tasks.",
    "Use the read tool to load a skill's file when the task matches its description.",
    "When a skill file references a relative path, resolve it against the skill directory.",
    "",
    "<available_skills>",
  ]

  for (const skill of visibleSkills) {
    lines.push("  <skill>")
    lines.push(`    <name>${escapeXml(skill.name)}</name>`)
    lines.push(`    <description>${escapeXml(skill.description)}</description>`)
    lines.push(`    <location>${escapeXml(skill.filePath)}</location>`)
    lines.push("  </skill>")
  }

  lines.push("</available_skills>")
  return lines.join("\n")
}
```

### Placement in System Prompt

The catalog is appended to `systemPrompt` at agent construction time:

```typescript
const skillCatalog = buildSkillsCatalog(skills)
const systemPrompt = basePrompt + skillCatalog
```

Since `systemPrompt` is a separate field on `AgentState` (not part of `messages`), the catalog is **never affected by compaction**. See [compaction.md](compaction.md#skill-catalog-protection) for details.
