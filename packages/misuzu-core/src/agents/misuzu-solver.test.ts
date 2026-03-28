import { mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "vite-plus/test"
import { Solver } from "./misuzu-solver.js"

describe("Solver prompts", () => {
  test("includes explicit expired-url escalation workflow", async () => {
    const root = join(tmpdir(), `misuzu-solver-prompt-${Date.now()}`)
    await mkdir(root, { recursive: true })

    const solver = new Solver({
      solverId: "web-1",
      cwd: root,
      workspaceRoot: root,
    })

    const prompt = solver.state.systemPrompt
    expect(prompt).toContain("notify_coordinator with kind=environment_expired")
    expect(prompt).toContain("Coordinator must refresh instance URL through browser workflow")
    expect(prompt).toContain("Do not invent, guess, or auto-rotate instance URLs yourself")
    expect(prompt).toContain("only for platform announcements/hints")

    await rm(root, { recursive: true, force: true })
  })
})
