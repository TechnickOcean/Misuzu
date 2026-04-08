import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vite-plus/test"
import { getModels } from "@mariozechner/pi-ai"
import { createCTFRuntimeWorkspaceWithoutPersistence } from "./workspace.ts"

const tempDirs: string[] = []

async function createRuntimeWorkspaceDir() {
  const dir = await mkdtemp(join(tmpdir(), "misuzu-ctf-runtime-"))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

async function writeProviderConfig(
  providerConfigPath: string,
  provider: string,
  sourceModelId: string,
) {
  await mkdir(join(providerConfigPath, ".."), { recursive: true })
  await writeFile(
    providerConfigPath,
    JSON.stringify(
      [
        {
          provider,
          baseProvider: "openai",
          modelMappings: [sourceModelId],
        },
      ],
      null,
      2,
    ),
    "utf-8",
  )
}

describe("ctf runtime providers", () => {
  test("bootstraps provider config only once until explicit reload", async () => {
    const sourceModel = getModels("openai")[0]
    expect(sourceModel).toBeDefined()

    const rootDir = await createRuntimeWorkspaceDir()
    const workspace = createCTFRuntimeWorkspaceWithoutPersistence({ rootDir })

    await writeProviderConfig(
      workspace.providerConfigPath,
      `ctf-proxy-${Date.now()}`,
      sourceModel!.id,
    )

    const firstLoad = workspace.bootstrapProviders()
    const secondLoad = workspace.bootstrapProviders()

    expect(firstLoad.length).toBe(1)
    expect(secondLoad.length).toBe(0)
    await workspace.shutdown()
  })

  test("reloads providers after settings update", async () => {
    const sourceModel = getModels("openai")[0]
    expect(sourceModel).toBeDefined()

    const rootDir = await createRuntimeWorkspaceDir()
    const workspace = createCTFRuntimeWorkspaceWithoutPersistence({ rootDir })
    const initialProvider = "ctf-provider-initial"
    const updatedProvider = "ctf-provider-updated"

    await writeProviderConfig(workspace.providerConfigPath, initialProvider, sourceModel!.id)
    workspace.bootstrapProviders()

    expect(workspace.getModel(initialProvider, sourceModel!.id)).toBeDefined()
    expect(
      workspace.listModelPoolCatalog().some((entry) => entry.provider === updatedProvider),
    ).toBe(false)

    await writeProviderConfig(workspace.providerConfigPath, updatedProvider, sourceModel!.id)
    workspace.reloadProviderConfig()

    expect(workspace.getModel(updatedProvider, sourceModel!.id)).toBeDefined()
    expect(
      workspace.listModelPoolCatalog().some((entry) => entry.provider === updatedProvider),
    ).toBe(true)
    await workspace.shutdown()
  })
})
