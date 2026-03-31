import { afterEach, describe, expect, test } from "vite-plus/test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getModels } from "@mariozechner/pi-ai"
import { sessionContextToken } from "../../infrastructure/di/tokens.js"
import { SessionContext } from "../session/context.js"
import { createWorkspace } from "./index.js"

const tempDirs: string[] = []

async function createWorkspaceWithProviderConfig(config: unknown) {
  const workspaceDir = await mkdtemp(join(tmpdir(), "misuzu-workspace-"))
  tempDirs.push(workspaceDir)
  const workspace = createWorkspace({ rootDir: workspaceDir })

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

    const workspace = createWorkspace({ rootDir: workspaceDir })
    const firstLoad = workspace.bootstrap()
    const secondLoad = workspace.bootstrap()

    expect(firstLoad.length).toBe(1)
    expect(secondLoad.length).toBe(0)
  })

  test("allows missing providers.json and returns empty registration", async () => {
    const workspaceDir = await createWorkspaceWithoutProviderConfig()
    const workspace = createWorkspace({ rootDir: workspaceDir })
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

    const wsA = createWorkspace({ rootDir: workspaceA })
    const wsB = createWorkspace({ rootDir: workspaceB })

    wsA.bootstrap()
    wsB.bootstrap()

    expect(wsA.getModel(providerName, sourceModel!.id)?.baseUrl).toBe(
      "https://proxy-a.example.com/v1",
    )
    expect(wsB.getModel(providerName, sourceModel!.id)?.baseUrl).toBe(
      "https://proxy-b.example.com/v1",
    )
  })

  test("main agent can only be created once per workspace", async () => {
    const sourceModel = getModels("openai")[0]
    expect(sourceModel).toBeDefined()

    const workspaceDir = await createWorkspaceWithProviderConfig([
      {
        provider: `proxy-key-${Date.now()}`,
        baseProvider: "openai",
        modelMappings: [sourceModel!.id],
      },
    ])
    const workspace = createWorkspace({ rootDir: workspaceDir })
    workspace.bootstrap()

    const mainAgent = workspace.createMainAgent()
    expect(mainAgent).toBeDefined()
    expect(() => workspace.createMainAgent()).toThrow("main agent")
  })

  test("main agent resolves api key from workspace provider registry", async () => {
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
    const workspace = createWorkspace({ rootDir: workspaceDir })
    workspace.bootstrap()

    const previousApiKey = process.env[apiKeyEnvVar]
    process.env[apiKeyEnvVar] = "workspace-provider-key"

    try {
      const mainAgent = workspace.createMainAgent()
      expect(await mainAgent.agent.getApiKey?.(providerName)).toBe("workspace-provider-key")
    } finally {
      if (previousApiKey === undefined) {
        delete process.env[apiKeyEnvVar]
      } else {
        process.env[apiKeyEnvVar] = previousApiKey
      }
    }
  })

  test("supports overriding dependencies via DI container", async () => {
    const sourceModel = getModels("openai")[0]
    expect(sourceModel).toBeDefined()

    const workspaceDir = await createWorkspaceWithProviderConfig([
      {
        provider: `proxy-session-${Date.now()}`,
        baseProvider: "openai",
        modelMappings: [sourceModel!.id],
      },
    ])

    const workspace = createWorkspace({
      rootDir: workspaceDir,
      configureContainer: (container) => {
        container.registerValue(sessionContextToken, new SessionContext("session-from-di"))
      },
    })

    const mainAgent = workspace.createMainAgent()
    expect(mainAgent.agent.sessionId).toBe("session-from-di")
  })
})
