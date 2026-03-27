import { expect, test, describe } from "vite-plus/test"
import { mkdir, writeFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  extractSkillFrontmatter,
  importSkillsFromDirectory,
  buildSkillsCatalog,
  loadAgentSkills,
} from "./skill.js"
import type { Skill } from "./skill.ts"

let testDir: string

async function createSkill(dir: string, name: string, content: string) {
  const skillDir = join(dir, name)
  await mkdir(skillDir, { recursive: true })
  await writeFile(join(skillDir, "SKILL.md"), content, "utf-8")
}

describe("extractSkillFrontmatter", () => {
  test("parses valid frontmatter", () => {
    const content = `---
name: test-skill
description: A test skill
allowed-tools: Bash(npx test:*)
---

# Test Skill

Do test things.`
    const { frontmatter, body } = extractSkillFrontmatter(content)
    expect(frontmatter.name).toBe("test-skill")
    expect(frontmatter.description).toBe("A test skill")
    expect(frontmatter["allowed-tools"]).toBe("Bash(npx test:*)")
    expect(body).toContain("# Test Skill")
  })

  test("returns empty frontmatter when no fence", () => {
    const content = "# Just markdown\nNo frontmatter here."
    const { frontmatter, body } = extractSkillFrontmatter(content)
    expect(Object.keys(frontmatter).length).toBe(0)
    expect(body).toBe(content)
  })

  test("handles empty frontmatter", () => {
    const content = `---
---
Body only`
    const { frontmatter, body } = extractSkillFrontmatter(content)
    expect(Object.keys(frontmatter).length).toBe(0)
    expect(body).toContain("Body only")
  })
})

describe("importSkillsFromDirectory", () => {
  test("finds skills in subdirectories", async () => {
    testDir = join(tmpdir(), `misuzu-skill-test-${Date.now()}`)
    await createSkill(
      testDir,
      "skill-a",
      `---
name: skill-a
description: First skill
---
Body A`,
    )
    await createSkill(
      testDir,
      "skill-b",
      `---
name: skill-b
description: Second skill
---
Body B`,
    )

    const skills = await importSkillsFromDirectory(testDir)
    expect(skills.length).toBe(2)
    expect(skills.map((s: Skill) => s.name).sort()).toEqual(["skill-a", "skill-b"])

    await rm(testDir, { recursive: true, force: true })
  })

  test("uses directory name as default skill name", async () => {
    testDir = join(tmpdir(), `misuzu-skill-test-${Date.now()}`)
    await createSkill(
      testDir,
      "my-skill",
      `---
description: Has no name field
---
Body`,
    )

    const skills = await importSkillsFromDirectory(testDir)
    expect(skills.length).toBe(1)
    expect(skills[0].name).toBe("my-skill")

    await rm(testDir, { recursive: true, force: true })
  })

  test("treats SKILL.md in root as single skill", async () => {
    testDir = join(tmpdir(), `misuzu-skill-test-${Date.now()}`)
    await mkdir(testDir, { recursive: true })
    await writeFile(
      join(testDir, "SKILL.md"),
      `---
name: root-skill
description: In root dir
---
Root body`,
      "utf-8",
    )

    const skills = await importSkillsFromDirectory(testDir)
    expect(skills.length).toBe(1)
    expect(skills[0].name).toBe("root-skill")

    await rm(testDir, { recursive: true, force: true })
  })
})

describe("buildSkillsCatalog", () => {
  test("formats skills as XML", () => {
    const catalog = buildSkillsCatalog([
      {
        name: "skill-a",
        description: "First",
        filePath: "/a/SKILL.md",
        baseDir: "/a",
        body: "x",
        allowedTools: [],
      },
      {
        name: "skill-b",
        description: "Second",
        filePath: "/b/SKILL.md",
        baseDir: "/b",
        body: "y",
        allowedTools: [],
      },
    ])
    expect(catalog).toContain("<available_skills>")
    expect(catalog).toContain("<name>skill-a</name>")
    expect(catalog).toContain("<description>First</description>")
    expect(catalog).toContain("<name>skill-b</name>")
    expect(catalog).toContain("</available_skills>")
  })

  test("returns empty string for no skills", () => {
    expect(buildSkillsCatalog([])).toBe("")
  })

  test("escapes XML special characters", () => {
    const catalog = buildSkillsCatalog([
      {
        name: "a&b",
        description: 'Use <tag> & "quotes"',
        filePath: "/x/SKILL.md",
        baseDir: "/x",
        body: "",
        allowedTools: [],
      },
    ])
    expect(catalog).toContain("a&amp;b")
    expect(catalog).toContain("&lt;tag&gt;")
    expect(catalog).toContain("&quot;quotes&quot;")
  })
})

describe("loadAgentSkills", () => {
  test("loads built-in shared + role skills", async () => {
    const root = join(tmpdir(), `misuzu-skill-test-${Date.now()}`)
    const misuzuRoot = join(root, "misuzu")

    await createSkill(
      join(misuzuRoot, ".misuzu", "skills", "shared"),
      "playwright-cli",
      `---
name: playwright-cli
description: shared browser skill
---
builtin`,
    )
    await createSkill(
      join(misuzuRoot, ".misuzu", "skills", "coordinator"),
      "coord-only",
      `---
name: coord-only
description: coordinator skill
---
builtin`,
    )

    const skills = loadAgentSkills({
      role: "coordinator",
      misuzuRoot,
      launchDir: misuzuRoot,
    })

    expect(skills.map((s) => s.name).sort()).toEqual(["coord-only", "playwright-cli"])

    await rm(root, { recursive: true, force: true })
  })

  test("loads workspace skills only when launch dir is not misuzu root", async () => {
    const root = join(tmpdir(), `misuzu-skill-test-${Date.now()}`)
    const misuzuRoot = join(root, "misuzu")
    const launchDir = join(root, "workspace")

    await createSkill(
      join(misuzuRoot, ".misuzu", "skills", "coordinator"),
      "dup-skill",
      `---
name: dup-skill
description: builtin
---
builtin`,
    )

    await createSkill(
      join(launchDir, ".misuzu", "skills", "coordinator"),
      "dup-skill",
      `---
name: dup-skill
description: workspace
---
workspace`,
    )

    const skills = loadAgentSkills({
      role: "coordinator",
      misuzuRoot,
      launchDir,
    })

    const resolved = skills.find((s) => s.name === "dup-skill")
    expect(resolved?.description).toBe("workspace")

    const noWorkspace = loadAgentSkills({
      role: "coordinator",
      misuzuRoot,
      launchDir: misuzuRoot,
    })
    expect(noWorkspace.find((s) => s.name === "dup-skill")?.description).toBe("builtin")

    await rm(root, { recursive: true, force: true })
  })

  test("solver loads shared + solver and excludes coordinator", async () => {
    const root = join(tmpdir(), `misuzu-skill-test-${Date.now()}`)
    const misuzuRoot = join(root, "misuzu")

    await createSkill(
      join(misuzuRoot, ".misuzu", "skills", "coordinator"),
      "coord-only",
      `---
name: coord-only
description: coordinator only
---
coord`,
    )
    await createSkill(
      join(misuzuRoot, ".misuzu", "skills", "solver"),
      "solver-only",
      `---
name: solver-only
description: solver only
---
solver`,
    )
    await createSkill(
      join(misuzuRoot, ".misuzu", "skills", "shared"),
      "shared-skill",
      `---
name: shared-skill
description: shared only
---
shared`,
    )

    const skills = loadAgentSkills({
      role: "solver",
      misuzuRoot,
      launchDir: misuzuRoot,
    })

    expect(skills.map((s) => s.name).sort()).toEqual(["shared-skill", "solver-only"])

    await rm(root, { recursive: true, force: true })
  })

  test("accepts .mizusu workspace marker alias", async () => {
    const root = join(tmpdir(), `misuzu-skill-test-${Date.now()}`)
    const misuzuRoot = join(root, "misuzu")
    const launchDir = join(root, "workspace")

    await createSkill(
      join(misuzuRoot, ".misuzu", "skills", "solver"),
      "builtin-solver",
      `---
name: builtin-solver
description: builtin solver
---
builtin`,
    )
    await createSkill(
      join(launchDir, ".mizusu", "skills", "solver"),
      "workspace-solver",
      `---
name: workspace-solver
description: workspace solver
---
workspace`,
    )

    const skills = loadAgentSkills({
      role: "solver",
      misuzuRoot,
      launchDir,
    })

    expect(skills.map((s) => s.name).sort()).toEqual(["builtin-solver", "workspace-solver"])

    await rm(root, { recursive: true, force: true })
  })
})
