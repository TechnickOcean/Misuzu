import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
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

describe("ctf runtime providers", () => {
  test("bootstraps provider config once", async () => {
    const sourceModel = getModels("openai")[0]
    expect(sourceModel).toBeDefined()

    const rootDir = await createRuntimeWorkspaceDir()
    const workspace = createCTFRuntimeWorkspaceWithoutPersistence({ rootDir })

    await mkdir(workspace.markerDir, { recursive: true })
    await writeFile(
      workspace.providerConfigPath,
      JSON.stringify(
        [
          {
            provider: `ctf-proxy-${Date.now()}`,
            baseProvider: "openai",
            modelMappings: [sourceModel!.id],
          },
        ],
        null,
        2,
      ),
      "utf-8",
    )

    const firstLoad = workspace.bootstrapProviders()
    const secondLoad = workspace.bootstrapProviders()

    expect(firstLoad.length).toBe(1)
    expect(secondLoad.length).toBe(0)
  })
})
