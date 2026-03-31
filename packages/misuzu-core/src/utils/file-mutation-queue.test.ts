import { describe, expect, test } from "vite-plus/test"
import { withFileMutationQueue } from "./file-mutation-queue.js"

describe("withFileMutationQueue", () => {
  test("executes operations sequentially for same path", async () => {
    const log: number[] = []

    const p1 = withFileMutationQueue("/a/file.txt", async () => {
      log.push(1)
      await new Promise((resolve) => setTimeout(resolve, 20))
      log.push(2)
    })

    const p2 = withFileMutationQueue("/a/file.txt", async () => {
      log.push(3)
      await new Promise((resolve) => setTimeout(resolve, 10))
      log.push(4)
    })

    await Promise.all([p1, p2])
    expect(log).toEqual([1, 2, 3, 4])
  })

  test("allows concurrent operations on different paths", async () => {
    const log: string[] = []

    const p1 = withFileMutationQueue("/a/file1.txt", async () => {
      log.push("start1")
      await new Promise((resolve) => setTimeout(resolve, 30))
      log.push("end1")
    })

    const p2 = withFileMutationQueue("/a/file2.txt", async () => {
      log.push("start2")
      await new Promise((resolve) => setTimeout(resolve, 10))
      log.push("end2")
    })

    await Promise.all([p1, p2])
    expect(log.indexOf("end2")).toBeLessThan(log.indexOf("end1"))
  })

  test("returns function result", async () => {
    const result = await withFileMutationQueue("/a/file.txt", async () => 42)
    expect(result).toBe(42)
  })

  test("propagates errors", async () => {
    await expect(
      withFileMutationQueue("/a/file.txt", async () => {
        throw new Error("fail")
      }),
    ).rejects.toThrow("fail")
  })
})
