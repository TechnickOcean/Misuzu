import { createServer } from "node:http"
import { existsSync } from "node:fs"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "vite-plus/test"
import type { AgentEvent } from "@mariozechner/pi-agent-core"
import type { AssistantMessage, StopReason } from "@mariozechner/pi-ai"
import { CompetitionPersistence, defaultWorkspacesRoot } from "../features/persistence.js"
import { Coordinator, ModelPool } from "./misuzu-coordinator.js"
import type { ModelSlot } from "./coordinator/model-pool.js"
import { Solver } from "./misuzu-solver.js"

function buildAssistantMessage(stopReason: StopReason, errorMessage?: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: "run end" }],
    api: "openai",
    provider: "openai",
    model: "gpt-test",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    errorMessage,
    timestamp: Date.now(),
  }
}

function createSolverEventHarness() {
  let handler: ((event: AgentEvent) => void) | undefined

  const solver = {
    subscribe(fn: (event: AgentEvent) => void) {
      handler = fn
      return () => {
        handler = undefined
      }
    },
  } as unknown as Solver

  return {
    solver,
    emit(event: AgentEvent) {
      handler?.(event)
    },
  }
}

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

  test("adds model slots dynamically", () => {
    const pool = new ModelPool(["rightcode/gpt-5.4"], { maxConcurrencyPerModel: 1 })

    const result = pool.addModel("rightcode/gpt-5.4", 2)

    expect(result.added).toBe(2)
    expect(result.total).toBe(3)
    expect(pool.available).toBe(3)
    expect(pool.total).toBe(3)
  })

  test("sets per-model concurrency when slots are idle", () => {
    const pool = new ModelPool(["rightcode/gpt-5.4"], { maxConcurrencyPerModel: 2 })

    const result = pool.setModelConcurrency("rightcode/gpt-5.4", 4)
    expect(result.previousTotal).toBe(2)
    expect(result.total).toBe(4)
    expect(result.added).toBe(2)
    expect(result.removed).toBe(0)

    const shrink = pool.setModelConcurrency("rightcode/gpt-5.4", 1)
    expect(shrink.previousTotal).toBe(4)
    expect(shrink.total).toBe(1)
    expect(shrink.added).toBe(0)
    expect(shrink.removed).toBe(3)
    expect(pool.available).toBe(1)
  })

  test("rejects concurrency below busy slots", () => {
    const pool = new ModelPool(["rightcode/gpt-5.4"], { maxConcurrencyPerModel: 2 })
    pool.acquire("solver-1")
    pool.acquire("solver-2")

    expect(() => pool.setModelConcurrency("rightcode/gpt-5.4", 0)).toThrowError(
      /Concurrency must be a positive integer/,
    )
    expect(() => pool.setModelConcurrency("rightcode/gpt-5.4", 1)).toThrowError(/busy/)
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

  test("coordinator can add model and update concurrency", async () => {
    const launchDir = join(tmpdir(), `misuzu-model-mutate-${Date.now()}`)
    await mkdir(launchDir, { recursive: true })

    const coordinator = new Coordinator({
      cwd: launchDir,
      workspaceRoot: launchDir,
      models: ["rightcode/gpt-5.4"],
      modelConcurrency: 1,
    })

    const addResult = coordinator.addModelToPool("rightcode/gpt-5.4", 2)
    expect(addResult.total).toBe(3)
    expect(coordinator.modelPool.available).toBe(3)

    const concurrencyResult = coordinator.setModelPoolConcurrency("rightcode/gpt-5.4", 2)
    expect(concurrencyResult.total).toBe(2)
    expect(coordinator.modelPool.available).toBe(2)

    const persisted = coordinator.persistence.loadCoordinatorState<{ modelPool?: ModelSlot[] }>()
    expect(persisted?.modelPool?.length).toBe(2)

    coordinator.persistence.close()
    await rm(launchDir, { recursive: true, force: true })
  })
})

describe("Coordinator environment updates", () => {
  test("uses coordinator cwd for shell tool execution", async () => {
    const launchDir = join(tmpdir(), `misuzu-coordinator-shell-cwd-${Date.now()}`)
    await mkdir(launchDir, { recursive: true })

    const coordinator = new Coordinator({
      cwd: launchDir,
      workspaceRoot: launchDir,
      models: ["rightcode/gpt-5.4"],
      modelPool: new ModelPool(["rightcode/gpt-5.4"]),
    })

    const shellTool = coordinator.state.tools.find((tool) => tool.name === "shell")
    expect(shellTool).toBeDefined()

    const command =
      process.platform === "win32" ? "Get-Location | Select-Object -ExpandProperty Path" : "pwd"

    const result = await shellTool!.execute("tool-shell-cwd", { command })
    const output =
      result.content.find((chunk) => chunk.type === "text" && "text" in chunk)?.text ?? ""

    expect(output.toLowerCase()).toContain(launchDir.toLowerCase())

    coordinator.persistence.close()
    await rm(launchDir, { recursive: true, force: true })
  })

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

describe("Coordinator URL pending queue", () => {
  test("queues no-attachment challenge as url_pending when remote URL is missing", async () => {
    const launchDir = join(tmpdir(), `misuzu-url-pending-${Date.now()}`)
    await mkdir(launchDir, { recursive: true })

    const originalSolve = Object.getOwnPropertyDescriptor(Solver.prototype, "solve")?.value as
      | Solver["solve"]
      | undefined
    Solver.prototype.solve = async () => undefined

    try {
      const coordinator = new Coordinator({
        cwd: launchDir,
        workspaceRoot: launchDir,
        models: ["rightcode/gpt-5.4"],
        modelPool: new ModelPool(["rightcode/gpt-5.4"]),
      })

      const createTool = coordinator.getCreateSolverTool()
      const result = (await createTool.execute("tool-url-pending", {
        challengeId: "web-remote",
        challengeName: "Remote Only",
        category: "web",
        description: "remote only challenge",
      })) as { details?: { urlPending?: boolean } }

      expect(result.details?.urlPending).toBe(true)
      expect(
        coordinator.persistence.loadSolverState<{ status?: string }>("web-remote")?.status,
      ).toBe("url_pending")

      coordinator.persistence.close()
    } finally {
      if (originalSolve) {
        Solver.prototype.solve = originalSolve
      }
      await rm(launchDir, { recursive: true, force: true })
    }
  })

  test("activates pending challenge after remote slot frees up", async () => {
    const launchDir = join(tmpdir(), `misuzu-url-activate-${Date.now()}`)
    await mkdir(launchDir, { recursive: true })

    const originalSolve = Object.getOwnPropertyDescriptor(Solver.prototype, "solve")?.value as
      | Solver["solve"]
      | undefined
    Solver.prototype.solve = async () => undefined

    try {
      const coordinator = new Coordinator({
        cwd: launchDir,
        workspaceRoot: launchDir,
        models: ["rightcode/gpt-5.4"],
        modelPool: new ModelPool(["rightcode/gpt-5.4", "rightcode/gpt-5.4"]),
        remoteUrlConcurrency: 1,
      })

      const createTool = coordinator.getCreateSolverTool()

      await createTool.execute("tool-remote-a", {
        challengeId: "remote-a",
        challengeName: "Remote A",
        category: "web",
        description: "remote a",
        remoteUrl: "https://ctf.example.com/a",
      })

      const pending = (await createTool.execute("tool-remote-b", {
        challengeId: "remote-b",
        challengeName: "Remote B",
        category: "web",
        description: "remote b",
        remoteUrl: "https://ctf.example.com/b",
      })) as { details?: { urlPending?: boolean } }

      expect(pending.details?.urlPending).toBe(true)
      expect(coordinator.solvers.has("remote-b")).toBe(false)

      const internal = coordinator as unknown as {
        onSolverFinished: (solverId: string, status: "solved" | "failed") => void
      }
      internal.onSolverFinished("remote-a", "solved")
      await new Promise<void>((resolve) => setTimeout(resolve, 20))

      expect(coordinator.solvers.has("remote-b")).toBe(true)
      coordinator.persistence.close()
    } finally {
      if (originalSolve) {
        Solver.prototype.solve = originalSolve
      }
      await rm(launchDir, { recursive: true, force: true })
    }
  })

  test("marks attachment challenges with local-first remote workflow", async () => {
    const launchDir = join(tmpdir(), `misuzu-local-first-${Date.now()}`)
    await mkdir(launchDir, { recursive: true })

    const attachmentPath = join(launchDir, "sample.txt")
    await writeFile(attachmentPath, "sample", "utf-8")

    const originalSolve = Object.getOwnPropertyDescriptor(Solver.prototype, "solve")?.value as
      | Solver["solve"]
      | undefined
    Solver.prototype.solve = async () => undefined

    try {
      const coordinator = new Coordinator({
        cwd: launchDir,
        workspaceRoot: launchDir,
        models: ["rightcode/gpt-5.4"],
        modelPool: new ModelPool(["rightcode/gpt-5.4"]),
      })

      const createTool = coordinator.getCreateSolverTool()
      await createTool.execute("tool-local-first", {
        challengeId: "rev-local",
        challengeName: "Rev Local",
        category: "reversing",
        description: "local first",
        files: ["sample.txt"],
        remoteUrl: "https://ctf.example.com/rev",
      })

      const env = await readFile(
        coordinator.persistence.getSolverEnvironmentPath("rev-local"),
        "utf-8",
      )
      expect(env).toContain("Local-first workflow")
      expect(env).toContain("validate your local exploit path first")

      coordinator.persistence.close()
    } finally {
      if (originalSolve) {
        Solver.prototype.solve = originalSolve
      }
      await rm(launchDir, { recursive: true, force: true })
    }
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
    })

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

describe("Coordinator solver lifecycle", () => {
  test("keeps unsolved solver active after normal agent_end", async () => {
    const launchDir = join(tmpdir(), `misuzu-solver-lifecycle-${Date.now()}`)
    await mkdir(launchDir, { recursive: true })

    const coordinator = new Coordinator({
      cwd: launchDir,
      workspaceRoot: launchDir,
      models: ["rightcode/gpt-5.4"],
      modelPool: new ModelPool(["rightcode/gpt-5.4"]),
    })

    const challengeId = "web-unsolved"
    const challengeName = "web unsolved"

    coordinator.modelPool.acquire(challengeId)
    coordinator.persistence.saveSolverState(challengeId, {
      solverId: challengeId,
      challengeName,
      status: "solving",
    })

    const harness = createSolverEventHarness()
    coordinator.solvers.set(challengeId, harness.solver)

    const internal = coordinator as unknown as {
      attachSolverLifecycle: (challengeId: string, challengeName: string, solver: Solver) => void
    }
    internal.attachSolverLifecycle(challengeId, challengeName, harness.solver)

    const assistant = buildAssistantMessage("stop")
    harness.emit({ type: "turn_end", message: assistant, toolResults: [] })
    harness.emit({ type: "agent_end", messages: [assistant] })

    expect(coordinator.solvers.has(challengeId)).toBe(true)
    expect(coordinator.modelPool.available).toBe(0)

    const state = coordinator.persistence.loadSolverState<{
      status?: string
      lastAgentEndReason?: string
    }>(challengeId)
    expect(state?.status).toBe("solving")
    expect(state?.lastAgentEndReason).toBe("stop")

    coordinator.persistence.close()
    await rm(launchDir, { recursive: true, force: true })
  })

  test("releases failed solver slot on error agent_end", async () => {
    const launchDir = join(tmpdir(), `misuzu-solver-error-${Date.now()}`)
    await mkdir(launchDir, { recursive: true })

    const coordinator = new Coordinator({
      cwd: launchDir,
      workspaceRoot: launchDir,
      models: ["rightcode/gpt-5.4"],
      modelPool: new ModelPool(["rightcode/gpt-5.4"]),
    })

    const challengeId = "crypto-error"
    const challengeName = "crypto error"

    coordinator.modelPool.acquire(challengeId)
    coordinator.persistence.saveSolverState(challengeId, {
      solverId: challengeId,
      challengeName,
      status: "solving",
    })

    const harness = createSolverEventHarness()
    coordinator.solvers.set(challengeId, harness.solver)

    const internal = coordinator as unknown as {
      attachSolverLifecycle: (challengeId: string, challengeName: string, solver: Solver) => void
    }
    internal.attachSolverLifecycle(challengeId, challengeName, harness.solver)

    const assistant = buildAssistantMessage("error", "tool crashed")
    harness.emit({ type: "turn_end", message: assistant, toolResults: [] })
    harness.emit({ type: "agent_end", messages: [assistant] })

    expect(coordinator.solvers.has(challengeId)).toBe(false)
    expect(coordinator.modelPool.available).toBe(1)

    const state = coordinator.persistence.loadSolverState<{
      status?: string
      lastAgentEndReason?: string
      lastAgentEndError?: string
    }>(challengeId)
    expect(state?.status).toBe("failed")
    expect(state?.lastAgentEndReason).toBe("error")
    expect(state?.lastAgentEndError).toBe("tool crashed")

    coordinator.persistence.close()
    await rm(launchDir, { recursive: true, force: true })
  })
})

describe("Coordinator queue dispatch", () => {
  test("appends scheduler update when queued challenge auto-dispatches", async () => {
    const launchDir = join(tmpdir(), `misuzu-queue-dispatch-${Date.now()}`)
    await mkdir(launchDir, { recursive: true })

    const coordinator = new Coordinator({
      cwd: launchDir,
      workspaceRoot: launchDir,
      models: ["rightcode/gpt-5.4"],
      modelPool: new ModelPool(["rightcode/gpt-5.4"]),
    })

    coordinator.challengeQueue.push({
      challengeId: "crypto-102",
      challengeName: "Small e",
      category: "crypto",
      description: "rsa",
    })

    const internal = coordinator as unknown as {
      dispatchQueuedChallenges: () => Promise<void>
      getCreateSolverTool: () => {
        execute: (
          toolCallId: string,
          params: unknown,
        ) => Promise<{ details?: { queued?: boolean; model?: string }; content: unknown[] }>
      }
    }

    internal.getCreateSolverTool = () => ({
      execute: async (_toolCallId, _params) => ({
        content: [{ type: "text", text: "started" }],
        details: { queued: false, model: "rightcode/gpt-5.4" },
      }),
    })

    await internal.dispatchQueuedChallenges()

    const schedulerMessage = coordinator.state.messages.find((m) => m.role === "schedulerUpdate") as
      | {
          role: "schedulerUpdate"
          challengeId: string
          status: string
          reason: string
          queueBefore: number
          queueAfter: number
        }
      | undefined

    expect(schedulerMessage?.challengeId).toBe("crypto-102")
    expect(schedulerMessage?.status).toBe("started")
    expect(schedulerMessage?.reason).toBe("slot_freed_auto_dispatch")
    expect(schedulerMessage?.queueBefore).toBe(1)
    expect(schedulerMessage?.queueAfter).toBe(0)

    coordinator.persistence.close()
    await rm(launchDir, { recursive: true, force: true })
  })

  test("skips dispatch for already active challenge", async () => {
    const launchDir = join(tmpdir(), `misuzu-queue-skip-active-${Date.now()}`)
    await mkdir(launchDir, { recursive: true })

    const coordinator = new Coordinator({
      cwd: launchDir,
      workspaceRoot: launchDir,
      models: ["rightcode/gpt-5.4"],
      modelPool: new ModelPool(["rightcode/gpt-5.4"]),
    })

    coordinator.challengeQueue.push({
      challengeId: "web-101",
      challengeName: "Login Lab",
      category: "web",
      description: "auth",
    })

    coordinator.solvers.set("web-101", createSolverEventHarness().solver)

    let executeCalls = 0
    const internal = coordinator as unknown as {
      dispatchQueuedChallenges: () => Promise<void>
      getCreateSolverTool: () => {
        execute: (
          toolCallId: string,
          params: unknown,
        ) => Promise<{ details?: { queued?: boolean; model?: string }; content: unknown[] }>
      }
    }

    internal.getCreateSolverTool = () => ({
      execute: async (_toolCallId, _params) => {
        executeCalls += 1
        return {
          content: [{ type: "text", text: "should not run" }],
          details: { queued: false, model: "rightcode/gpt-5.4" },
        }
      },
    })

    await internal.dispatchQueuedChallenges()

    const schedulerMessage = coordinator.state.messages.find((m) => m.role === "schedulerUpdate") as
      | {
          role: "schedulerUpdate"
          challengeId: string
          status: string
          reason: string
          queueBefore: number
          queueAfter: number
        }
      | undefined

    expect(executeCalls).toBe(0)
    expect(schedulerMessage?.challengeId).toBe("web-101")
    expect(schedulerMessage?.status).toBe("skipped")
    expect(schedulerMessage?.reason).toBe("already_active")
    expect(schedulerMessage?.queueBefore).toBe(1)
    expect(schedulerMessage?.queueAfter).toBe(0)

    coordinator.persistence.close()
    await rm(launchDir, { recursive: true, force: true })
  })

  test("skips dispatch for finalized challenge state", async () => {
    const launchDir = join(tmpdir(), `misuzu-queue-skip-finalized-${Date.now()}`)
    await mkdir(launchDir, { recursive: true })

    const coordinator = new Coordinator({
      cwd: launchDir,
      workspaceRoot: launchDir,
      models: ["rightcode/gpt-5.4"],
      modelPool: new ModelPool(["rightcode/gpt-5.4"]),
    })

    coordinator.challengeQueue.push({
      challengeId: "rev-201",
      challengeName: "dead queue item",
      category: "reversing",
      description: "already solved",
    })

    coordinator.persistence.saveSolverState("rev-201", {
      solverId: "rev-201",
      status: "solved",
      updatedAt: new Date().toISOString(),
    })

    let executeCalls = 0
    const internal = coordinator as unknown as {
      dispatchQueuedChallenges: () => Promise<void>
      getCreateSolverTool: () => {
        execute: (
          toolCallId: string,
          params: unknown,
        ) => Promise<{ details?: { queued?: boolean; model?: string }; content: unknown[] }>
      }
    }

    internal.getCreateSolverTool = () => ({
      execute: async (_toolCallId, _params) => {
        executeCalls += 1
        return {
          content: [{ type: "text", text: "should not run" }],
          details: { queued: false, model: "rightcode/gpt-5.4" },
        }
      },
    })

    await internal.dispatchQueuedChallenges()

    const schedulerMessage = coordinator.state.messages.find((m) => m.role === "schedulerUpdate") as
      | {
          role: "schedulerUpdate"
          challengeId: string
          status: string
          reason: string
          queueBefore: number
          queueAfter: number
        }
      | undefined

    expect(executeCalls).toBe(0)
    expect(schedulerMessage?.challengeId).toBe("rev-201")
    expect(schedulerMessage?.status).toBe("skipped")
    expect(schedulerMessage?.reason).toBe("already_solved")
    expect(schedulerMessage?.queueBefore).toBe(1)
    expect(schedulerMessage?.queueAfter).toBe(0)

    coordinator.persistence.close()
    await rm(launchDir, { recursive: true, force: true })
  })
})
