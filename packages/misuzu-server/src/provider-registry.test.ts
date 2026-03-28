import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { describe, expect, test } from "vite-plus/test"
import { loadProviderRegistryPlugins } from "./provider-registry.js"

describe("provider registry plugins", () => {
  test("loads provider plugins from workspace .misuzu/providers", async () => {
    const root = join(tmpdir(), `misuzu-provider-registry-${Date.now()}`)
    const providersDir = join(root, ".misuzu", "providers")
    await mkdir(providersDir, { recursive: true })

    const pluginPath = join(providersDir, "sample.mjs")
    await writeFile(
      pluginPath,
      [
        "export default async function register() {",
        "  globalThis.__misuzuProviderPluginLoaded = (globalThis.__misuzuProviderPluginLoaded ?? 0) + 1",
        "}",
      ].join("\n"),
      "utf-8",
    )

    const logs: string[] = []
    const warns: string[] = []
    const result = await loadProviderRegistryPlugins(root, {
      log: (message) => {
        logs.push(message)
      },
      warn: (message) => {
        warns.push(message)
      },
    })

    expect(result.discovered).toBe(1)
    expect(result.loaded).toBe(1)
    expect(result.errors.length).toBe(0)
    expect(logs.some((line) => line.includes("sample.mjs"))).toBe(true)
    expect(warns.length).toBe(0)
    expect(
      (globalThis as { __misuzuProviderPluginLoaded?: number }).__misuzuProviderPluginLoaded,
    ).toBe(1)

    delete (globalThis as { __misuzuProviderPluginLoaded?: number }).__misuzuProviderPluginLoaded
    await rm(root, { recursive: true, force: true })
  })

  test("continues when a plugin fails", async () => {
    const root = join(tmpdir(), `misuzu-provider-registry-fail-${Date.now()}`)
    const providersDir = join(root, ".misuzu", "providers")
    await mkdir(providersDir, { recursive: true })

    await writeFile(
      join(providersDir, "broken.mjs"),
      ["export default function register() {", "  throw new Error('boom')", "}"].join("\n"),
      "utf-8",
    )

    const logs: string[] = []
    const warns: string[] = []
    const result = await loadProviderRegistryPlugins(root, {
      log: (message) => {
        logs.push(message)
      },
      warn: (message) => {
        warns.push(message)
      },
    })

    expect(result.discovered).toBe(1)
    expect(result.loaded).toBe(0)
    expect(result.errors.length).toBe(1)
    expect(result.errors[0]).toContain("boom")
    expect(logs.length).toBe(0)
    expect(warns.some((line) => line.includes("broken.mjs"))).toBe(true)

    await rm(root, { recursive: true, force: true })
  })
})
