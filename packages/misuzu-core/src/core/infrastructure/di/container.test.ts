import { describe, expect, test } from "vite-plus/test"
import { createContainer, createToken } from "./container.ts"

describe("container", () => {
  test("resolves singleton dependencies only once", () => {
    const container = createContainer()
    const token = createToken<{ createdAt: number }>("singleton")
    let createCount = 0

    container.registerSingleton(token, () => {
      createCount += 1
      return { createdAt: Date.now() }
    })

    const first = container.resolve(token)
    const second = container.resolve(token)

    expect(first).toBe(second)
    expect(createCount).toBe(1)
  })

  test("resolves transient dependencies as new instances", () => {
    const container = createContainer()
    const token = createToken<{ createdAt: number }>("transient")

    container.registerTransient(token, () => ({ createdAt: Date.now() }))

    const first = container.resolve(token)
    const second = container.resolve(token)

    expect(first).not.toBe(second)
  })

  test("throws when dependency is missing", () => {
    const container = createContainer()
    const token = createToken<string>("missing")
    expect(() => container.resolve(token)).toThrow("Missing dependency")
  })
})
