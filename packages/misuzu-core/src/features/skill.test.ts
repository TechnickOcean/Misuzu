import { expect, test, describe } from "vite-plus/test"
import { mkdir, writeFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { extractSkillFrontmatter, importSkillsFromDirectory, buildSkillsCatalog } from "./skill.js"
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
