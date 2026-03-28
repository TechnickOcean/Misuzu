# Skills

Skills are external instruction bundles (`SKILL.md`) that extend agent behavior without code changes.

## Core Model

- At startup, Misuzu loads skill metadata (`name`, `description`, `location`)
- Metadata is injected into `systemPrompt` as `<available_skills>` catalog
- Full skill content is loaded on demand by reading the skill file

This keeps always-on context small while preserving rich skill instructions.

## Skill Data Contract

`Skill` fields:

- `name`
- `description`
- `filePath`
- `baseDir`
- `body`
- `allowedTools`

Frontmatter parsing is lenient:

- Missing or malformed frontmatter does not hard-fail loading
- `name` defaults to parent directory name
- `description` defaults to empty string

## Directory Rules

`importSkillsFromDirectorySync(dir)` behavior:

1. If `<dir>/SKILL.md` exists, treat `dir` as one skill and stop there
2. Otherwise, scan immediate child directories for `<child>/SKILL.md`
3. Skip hidden directories and `node_modules`
4. Deduplicate symbolic-link targets

Notes:

- This loader is intentionally shallow and predictable
- It does not perform deep recursive discovery

## Skill Sources

Skills can come from three sources:

- built-in shared/role skills
- workspace shared/role skills
- `extraSkills` supplied programmatically

Load path resolution:

- built-in root: `<misuzu-root>/.misuzu/skills`
- workspace root: `<launch-dir>/.misuzu/skills` (or `.mizusu/skills` marker)

Merge precedence by name:

- built-in -> workspace -> extra (later source overrides earlier by skill name)

## Role Model

Roles:

- `shared`
- `coordinator`
- `solver`

`loadAgentSkills({ role, ... })` returns:

- `shared + role-specific` from built-ins
- plus `shared + role-specific` from workspace (when applicable)
- plus optional `extraSkills`

## Public API

Exported methods/types:

- `extractSkillFrontmatter(content)`
- `importSkillsFromDirectory(dir)`
- `importSkillsFromDirectorySync(dir)`
- `resolveMisuzuRoot(startDir?)`
- `loadBuiltinSkills(role, misuzuRoot?)`
- `loadWorkspaceSkills(role, launchDir, misuzuRoot?)`
- `loadAgentSkills(options)`
- `buildSkillsCatalog(skills)`
- `Skill`, `SkillRole`, `SkillFrontmatter`, `AgentSkillLoadOptions`

## Security Note

Skills are instruction text for the model.
Misuzu does not enforce policy/sandboxing based on skill content alone.
Only load skills from trusted sources.
