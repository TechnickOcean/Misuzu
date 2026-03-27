import { createServer } from "node:http"
import { existsSync } from "node:fs"
import { mkdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "vite-plus/test"
import { CompetitionPersistence, defaultWorkspacesRoot } from "../features/persistence.js"
import { Coordinator, ModelPool } from "./misuzu-coordinator.js"

describe("ModelPool", () => {
  test("supports multi-concurrency per model", () => {
    const pool = new ModelPool(["rightcode/gpt-5.4"], { maxConcurrencyPerModel: 3 })

    expect(pool.available).toBe(3)
    expect(pool.acquire("solver-1")).toBe("rightcode/gpt-5.4")
    expect(pool.acquire("solver-2")).toBe("rightcode/gpt-5.4")
    expect(pool.acquire("solver-3")).toBe("rightcode/gpt-5.4")
    expect(pool.acquire("solver-4")).toBeNull()

    pool.release("solver-2")
    expect(pool.available).toBe(1)
    expect(pool.acquire("solver-4")).toBe("rightcode/gpt-5.4")
    expect(pool.available).toBe(0)
  })

  test("coordinator modelConcurrency expands pool slots", async () => {
    const launchDir = join(tmpdir(), `misuzu-model-concurrency-${Date.now()}`)
    await mkdir(launchDir, { recursive: true })

    const coordinator = new Coordinator({
      cwd: launchDir,
      workspaceRoot: launchDir,
      models: ["rightcode/gpt-5.4"],
      modelConcurrency: 2,
    })

    expect(coordinator.modelPool.available).toBe(2)

    coordinator.persistence.close()
    await rm(launchDir, { recursive: true, force: true })
  })
})

describe("Coordinator environment updates", () => {
  test("verifies URL before updating solver ENVIRONMENT.md", async () => {
    const launchDir = join(tmpdir(), `misuzu-coordinator-test-${Date.now()}`)
    const workspacesRoot = defaultWorkspacesRoot(launchDir)
    await mkdir(launchDir, { recursive: true })

    const persistence = CompetitionPersistence.create(workspacesRoot, {
      id: "workspace-url-validation",
      name: "url validation",
      modelPool: ["rightcode/gpt-5.4"],
    })

    await persistence.ensureSolverWorkspace({
      solverId: "web-1",
      challengeName: "web test",
      category: "web",
      description: "test",
      launchDir,
      model: "rightcode/gpt-5.4",
    })

    const coordinator = new Coordinator({
      cwd: launchDir,
      workspaceRoot: launchDir,
      persistence,
      models: ["rightcode/gpt-5.4"],
      modelPool: new ModelPool(["rightcode/gpt-5.4"]),
    })

    const updateTool = coordinator.getUpdateSolverEnvironmentTool()

    const failed = (await updateTool.execute("tool-1", {
      challengeId: "web-1",
      updateType: "environment_url",
      content: "bad url",
      url: "http://127.0.0.1:1/unreachable",
    })) as { details?: { applied?: boolean; verified?: boolean } }

    expect(failed.details?.applied).toBe(false)
    expect(failed.details?.verified).toBe(false)

    const server = createServer((_req, res) => {
      res.statusCode = 200
      res.end("ok")
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    const port = typeof address === "object" && address ? address.port : 0
    const goodUrl = `http://127.0.0.1:${port}/env`

    const succeeded = (await updateTool.execute("tool-2", {
      challengeId: "web-1",
      updateType: "environment_url",
      content: "good url",
      url: goodUrl,
      expiresAt: "2026-03-30T00:00:00Z",
    })) as { details?: { applied?: boolean; verified?: boolean } }

    expect(succeeded.details?.applied).toBe(true)
    expect(succeeded.details?.verified).toBe(true)

    const envPath = persistence.getSolverEnvironmentPath("web-1")
    const env = await readFile(envPath, "utf-8")
    expect(env).toContain(`current url: ${goodUrl}`)

    await new Promise<void>((resolve) => server.close(() => resolve()))
    persistence.close()
    await rm(launchDir, { recursive: true, force: true })
  })
})

describe("Coordinator resume", () => {
  test("restores coordinator and solver state from workspace", async () => {
    const launchDir = join(tmpdir(), `misuzu-coordinator-resume-${Date.now()}`)
    const workspacesRoot = defaultWorkspacesRoot(launchDir)
    await mkdir(launchDir, { recursive: true })

    const persistence = CompetitionPersistence.create(workspacesRoot, {
      id: "workspace-resume",
      name: "resume test",
      modelPool: ["rightcode/gpt-5.4"],
    })

    const solverWorkspace = await persistence.ensureSolverWorkspace({
      solverId: "crypto-1",
      challengeName: "crypto test",
      category: "crypto",
      description: "recover me",
      model: "rightcode/gpt-5.4",
      launchDir,
    })

    solverWorkspace.session.appendMessage({
      role: "user",
      content: "resume context",
      timestamp: Date.now(),
    } as any)

    persistence.saveSolverState("crypto-1", {
      solverId: "crypto-1",
      challengeName: "crypto test",
      category: "crypto",
      description: "recover me",
      status: "solving",
      model: "rightcode/gpt-5.4",
      cwd: solverWorkspace.rootDir,
      environmentPath: solverWorkspace.environmentPath,
      scriptsDir: solverWorkspace.scriptsDir,
      writeupPath: solverWorkspace.writeupPath,
    })

    persistence.saveCoordinatorState({
      workspaceRoot: launchDir,
      modelPool: [{ model: "rightcode/gpt-5.4", status: "busy", solverId: "crypto-1" }],
      solvers: ["crypto-1"],
      challengeQueue: [
        {
          challengeId: "pwn-queued",
          challengeName: "pwn test",
          category: "pwn",
          description: "queued",
        },
      ],
    })
    persistence.close()

    const resumed = Coordinator.resumeFromWorkspace({
      workspaceDir: join(workspacesRoot, "workspace-resume"),
      autoContinueSolvers: false,
    })

    expect(resumed.solvers.has("crypto-1")).toBe(true)
    expect(resumed.challengeQueue.length).toBe(1)
    expect(existsSync(resumed.persistence.getSolverEnvironmentPath("crypto-1"))).toBe(true)

    resumed.persistence.close()
    await rm(launchDir, { recursive: true, force: true })
  })
})
