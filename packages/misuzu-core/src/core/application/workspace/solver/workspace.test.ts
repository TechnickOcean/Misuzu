import { afterEach, describe, expect, test } from "vite-plus/test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getModels } from "@mariozechner/pi-ai"
import { createSolverWorkspaceWithoutPersistence } from "./workspace.ts"

const tempDirs: string[] = []

async function createWorkspaceWithProviderConfig(config: unknown) {
  const workspaceDir = await mkdtemp(join(tmpdir(), "misuzu-workspace-"))
  tempDirs.push(workspaceDir)
  const workspace = createSolverWorkspaceWithoutPersistence({ rootDir: workspaceDir })

  await mkdir(workspace.markerDir, { recursive: true })
  await writeFile(workspace.providerConfigPath, JSON.stringify(config, null, 2), "utf-8")
  return workspaceDir
}

async function createWorkspaceWithoutProviderConfig() {
  const workspaceDir = await mkdtemp(join(tmpdir(), "misuzu-workspace-"))
  tempDirs.push(workspaceDir)
  return workspaceDir
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

describe("workspace provider registry", () => {
  test("bootstraps provider config once", async () => {
    const sourceModel = getModels("openai")[0]
    expect(sourceModel).toBeDefined()

    const workspaceDir = await createWorkspaceWithProviderConfig([
      {
        provider: `proxy-boot-${Date.now()}`,
        baseProvider: "openai",
        modelMappings: [sourceModel!.id],
      },
    ])

    const workspace = createSolverWorkspaceWithoutPersistence({ rootDir: workspaceDir })
    const firstLoad = workspace.bootstrap()
    const secondLoad = workspace.bootstrap()

    expect(firstLoad.length).toBe(1)
    expect(secondLoad.length).toBe(0)
  })

  test("allows missing providers.json and returns empty registration", async () => {
    const workspaceDir = await createWorkspaceWithoutProviderConfig()
    const workspace = createSolverWorkspaceWithoutPersistence({ rootDir: workspaceDir })
    expect(workspace.bootstrap()).toEqual([])
  })

  test("reads inline api_key from providers.json for built-in providers", async () => {
    const workspaceDir = await createWorkspaceWithProviderConfig([
      {
        provider: "openai",
        api_key: "inline-openai-key",
      },
    ])

    const workspace = createSolverWorkspaceWithoutPersistence({ rootDir: workspaceDir })
    workspace.bootstrap()

    expect(workspace.providers.getApiKey("openai")).toBe("inline-openai-key")
  })

  test("keeps provider registries isolated between workspaces", async () => {
    const sourceModel = getModels("openai")[0]
    expect(sourceModel).toBeDefined()

    const providerName = `proxy-${Date.now()}`
    const workspaceA = await createWorkspaceWithProviderConfig([
      {
        provider: providerName,
        baseProvider: "openai",
        baseUrl: "https://proxy-a.example.com/v1",
        modelMappings: [sourceModel!.id],
      },
    ])
    const workspaceB = await createWorkspaceWithProviderConfig([
      {
        provider: providerName,
        baseProvider: "openai",
        baseUrl: "https://proxy-b.example.com/v1",
        modelMappings: [sourceModel!.id],
      },
    ])

    const wsA = createSolverWorkspaceWithoutPersistence({ rootDir: workspaceA })
    const wsB = createSolverWorkspaceWithoutPersistence({ rootDir: workspaceB })

    wsA.bootstrap()
    wsB.bootstrap()

    expect(wsA.getModel(providerName, sourceModel!.id)?.baseUrl).toBe(
      "https://proxy-a.example.com/v1",
    )
    expect(wsB.getModel(providerName, sourceModel!.id)?.baseUrl).toBe(
      "https://proxy-b.example.com/v1",
    )
  })

  test("creates solver as main agent", async () => {
    const workspaceDir = await createWorkspaceWithoutProviderConfig()
    const workspace = createSolverWorkspaceWithoutPersistence({ rootDir: workspaceDir })

    const mainAgent = await workspace.createMainAgent()

    expect(mainAgent).toBeDefined()
    expect(mainAgent.state.systemPrompt).toContain("Solver agent")
    expect(mainAgent.state.systemPrompt).toContain("ctf-sandbox:latest")
  })

  test("rejects creating a second main agent", async () => {
    const workspaceDir = await createWorkspaceWithoutProviderConfig()
    const workspace = createSolverWorkspaceWithoutPersistence({ rootDir: workspaceDir })

    await workspace.createMainAgent()

    await expect(workspace.createMainAgent()).rejects.toThrow("Workspace already has a main agent")
  })

  test("uses parent config root for providers and skills", async () => {
    const sourceModel = getModels("openai")[0]
    expect(sourceModel).toBeDefined()

    const parentDir = await mkdtemp(join(tmpdir(), "misuzu-parent-workspace-"))
    const solverDir = join(parentDir, "solvers", "solver-a")
    tempDirs.push(parentDir)

    await mkdir(join(parentDir, ".misuzu", "skills", "parent-skill"), { recursive: true })
    await writeFile(
      join(parentDir, ".misuzu", "skills", "parent-skill", "SKILL.md"),
      [
        "---",
        "name: parent-skill",
        "description: parent skill",
        "---",
        "",
        "Parent skill body",
      ].join("\n"),
      "utf-8",
    )

    await writeFile(
      join(parentDir, ".misuzu", "providers.json"),
      JSON.stringify(
        [
          {
            provider: "parent-provider",
            baseProvider: "openai",
            modelMappings: [sourceModel!.id],
          },
        ],
        null,
        2,
      ),
      "utf-8",
    )

    const workspace = createSolverWorkspaceWithoutPersistence({
      rootDir: solverDir,
      configRootDir: parentDir,
    })

    workspace.bootstrap()
    expect(workspace.getModel("parent-provider", sourceModel!.id)).toBeDefined()

    const solver = await workspace.createMainAgent()
    expect(solver.state.systemPrompt).toContain("parent-skill")
    expect(workspace.rootDir).toBe(solverDir)
    expect(workspace.configRootDir).toBe(parentDir)
  })
})
