import { describe, expect, test } from "vite-plus/test"
import { createDockerTools } from "./docker.js"

describe("docker tools", () => {
  test("uses injected cwd when running docker commands", async () => {
    const calls: { command: string; cwd: string }[] = []

    const dockerTools = createDockerTools("/workspace-a", {
      exec: async (command, cwd, options) => {
        calls.push({ command, cwd })
        options.onData(Buffer.from("ok"))
        return { exitCode: 0, timedOut: false, aborted: false }
      },
    })

    await dockerTools.dockerBuildTool.execute("id", {
      dockerfile: "Dockerfile",
      tag: "test:latest",
      context: ".",
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].cwd).toBe("/workspace-a")
    expect(calls[0].command).toContain("docker build")
  })
})
