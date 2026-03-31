import { afterEach, describe, expect, test } from "vite-plus/test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getModels } from "@mariozechner/pi-ai"
import { FeaturedAgent } from "../agents/featured.js"
import { getWorkspace } from "./index.js"

const tempDirs: string[] = []

async function createWorkspaceWithProviderConfig(config: unknown) {
  const workspaceDir = await mkdtemp(join(tmpdir(), "misuzu-workspace-"))
  tempDirs.push(workspaceDir)
  const workspace = getWorkspace(workspaceDir)

  await mkdir(workspace.markerDir, { recursive: true })
  await writeFile(workspace.providerConfigPath, JSON.stringify(config, null, 2), "utf-8")
  return workspaceDir
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

describe("workspace provider registry", () => {
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

    const wsA = getWorkspace(workspaceA)
    const wsB = getWorkspace(workspaceB)

    wsA.registerProxyProvidersOnce()
    wsB.registerProxyProvidersOnce()

    expect(wsA.getModel(providerName, sourceModel!.id)?.baseUrl).toBe(
      "https://proxy-a.example.com/v1",
    )
    expect(wsB.getModel(providerName, sourceModel!.id)?.baseUrl).toBe(
      "https://proxy-b.example.com/v1",
    )
  })

  test("FeaturedAgent reads api key from workspace registry", async () => {
    const sourceModel = getModels("openai")[0]
    expect(sourceModel).toBeDefined()

    const providerName = `proxy-key-${Date.now()}`
    const apiKeyEnvVar = `WORKSPACE_PROXY_KEY_${Date.now()}`
    const workspaceDir = await createWorkspaceWithProviderConfig([
      {
        provider: providerName,
        baseProvider: "openai",
        apiKeyEnvVar,
        modelMappings: [sourceModel!.id],
      },
    ])

    const previousApiKey = process.env[apiKeyEnvVar]
    process.env[apiKeyEnvVar] = "workspace-provider-key"

    try {
      const agent = new FeaturedAgent({ cwd: workspaceDir })
      expect(await agent.agent.getApiKey?.(providerName)).toBe("workspace-provider-key")
    } finally {
      if (previousApiKey === undefined) {
        delete process.env[apiKeyEnvVar]
      } else {
        process.env[apiKeyEnvVar] = previousApiKey
      }
    }
  })
})
