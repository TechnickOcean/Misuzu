import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, normalize } from "node:path"
import { afterEach, describe, expect, test } from "vite-plus/test"
import type { PersistenceStore } from "../core/application/persistence/store.ts"
import { ProviderRegistry } from "../core/application/providers/index.ts"
import type { Logger } from "../core/infrastructure/logging/types.ts"
import {
  EnvironmentAgent,
  createDefaultEnvironmentAgent,
  resolveDefaultEnvironmentBaseDir,
} from "./environment.ts"

const tempDirs: string[] = []

const noopLogger: Logger = {
  child: () => noopLogger,
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

const noopPersistence: PersistenceStore = {
  async initialize() {},
  async hasPersistedState() {
    return false
  },
  async restoreState() {
    return null
  },
  async recordChange() {},
  getCurrentState() {
    return null
  },
  async flush() {},
  async clear() {},
}

async function createSkillWorkspace() {
  const dir = await mkdtemp(join(tmpdir(), "misuzu-env-agent-"))
  tempDirs.push(dir)

  const skillDir = join(dir, ".misuzu", "skills", "custom-plugin-skill")
  await mkdir(skillDir, { recursive: true })
  await writeFile(
    join(skillDir, "SKILL.md"),
    [
      "---",
      "name: custom-plugin-skill",
      "description: Test-only plugin authoring skill",
      "allowed-tools: Read, Write",
      "---",
      "",
      "Use this skill to validate environment skill loading.",
    ].join("\n"),
    "utf-8",
  )

  return dir
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

describe("environment agent", () => {
  test("loads workspace skills from configured plugins base", async () => {
    const workspaceBaseDir = await createSkillWorkspace()

    const environmentAgent = new EnvironmentAgent(
      {
        cwd: process.cwd(),
        logger: noopLogger,
        providers: new ProviderRegistry(),
        persistence: noopPersistence,
      },
      {
        workspaceBaseDir,
      },
    )

    expect(environmentAgent.workspaceBaseDir).toBe(workspaceBaseDir)
    expect(environmentAgent.state.systemPrompt).toContain("Environment agent")
    expect(environmentAgent.state.systemPrompt).toContain("custom-plugin-skill")
    expect(environmentAgent.state.tools.map((tool) => tool.name)).toContain("scaffold_plugin")
    expect(environmentAgent.state.tools.map((tool) => tool.name)).toContain(
      "deploy_platform_plugin",
    )
  })

  test("default factory uses built-in plugins workspace and target deployment path", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "misuzu-env-target-"))
    tempDirs.push(workspaceRoot)

    const environmentAgent = createDefaultEnvironmentAgent({
      cwd: workspaceRoot,
      logger: noopLogger,
      providers: new ProviderRegistry(),
      persistence: noopPersistence,
    })

    expect(normalize(environmentAgent.workspaceBaseDir)).toBe(
      normalize(resolveDefaultEnvironmentBaseDir()),
    )
    expect(environmentAgent.targetWorkspaceDir).toBe(workspaceRoot)
    expect(environmentAgent.state.systemPrompt).toContain("Standard plugin workflow")
    expect(environmentAgent.state.systemPrompt).toContain("deploy_platform_plugin")
    expect(environmentAgent.state.systemPrompt).toContain("plugin-authoring skill")
    expect(environmentAgent.state.systemPrompt).toContain(
      normalize(join(workspaceRoot, ".misuzu", "platform-plugin")),
    )
  })
})
