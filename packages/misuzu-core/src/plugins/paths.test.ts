import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, test } from "vite-plus/test"
import { resolveBuiltinPluginCatalogPath, resolveBuiltinPluginWorkspaceDir } from "./paths.ts"

const tempDirs: string[] = []

afterEach(async () => {
  delete process.env.MISUZU_BUILTIN_PLUGIN_DIR
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

describe("plugin path resolution", () => {
  test("resolves built-in plugin catalog from package workspace", async () => {
    const catalogPath = resolveBuiltinPluginCatalogPath()
    await expect(access(catalogPath)).resolves.toBeUndefined()
  })

  test("supports overriding builtin plugin workspace directory", async () => {
    const overrideDir = await mkdtemp(join(tmpdir(), "misuzu-plugin-path-"))
    tempDirs.push(overrideDir)

    await mkdir(overrideDir, { recursive: true })
    await writeFile(join(overrideDir, "catalog.json"), "[]\n", "utf-8")

    process.env.MISUZU_BUILTIN_PLUGIN_DIR = overrideDir

    expect(resolveBuiltinPluginWorkspaceDir()).toBe(resolve(overrideDir))
    expect(resolveBuiltinPluginCatalogPath()).toBe(resolve(overrideDir, "catalog.json"))
  })
})
