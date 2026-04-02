import { afterEach, describe, expect, test } from "vite-plus/test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getModels } from "@mariozechner/pi-ai"
import { createWorkspaceWithoutPersistence } from "./index.ts"

const tempDirs: string[] = []

async function createWorkspaceWithProviderConfig(config: unknown) {
  const workspaceDir = await mkdtemp(join(tmpdir(), "misuzu-workspace-"))
  tempDirs.push(workspaceDir)
  const workspace = createWorkspaceWithoutPersistence({ rootDir: workspaceDir })

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

    const workspace = createWorkspaceWithoutPersistence({ rootDir: workspaceDir })
    const firstLoad = workspace.bootstrap()
    const secondLoad = workspace.bootstrap()

    expect(firstLoad.length).toBe(1)
    expect(secondLoad.length).toBe(0)
  })

  test("allows missing providers.json and returns empty registration", async () => {
    const workspaceDir = await createWorkspaceWithoutProviderConfig()
    const workspace = createWorkspaceWithoutPersistence({ rootDir: workspaceDir })
    expect(workspace.bootstrap()).toEqual([])
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

    const wsA = createWorkspaceWithoutPersistence({ rootDir: workspaceA })
    const wsB = createWorkspaceWithoutPersistence({ rootDir: workspaceB })

    wsA.bootstrap()
    wsB.bootstrap()

    expect(wsA.getModel(providerName, sourceModel!.id)?.baseUrl).toBe(
      "https://proxy-a.example.com/v1",
    )
    expect(wsB.getModel(providerName, sourceModel!.id)?.baseUrl).toBe(
      "https://proxy-b.example.com/v1",
    )
  })
})
