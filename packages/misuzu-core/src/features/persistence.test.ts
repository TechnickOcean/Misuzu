import { describe, expect, test } from "vite-plus/test"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { AgentEvent, AgentMessage } from "@mariozechner/pi-agent-core"
import {
  AgentSessionRecorder,
  CompetitionPersistence,
  SessionManager,
  createWorkspaceId,
  defaultWorkspacesRoot,
} from "./persistence.js"

function userMessage(content: string): AgentMessage {
  return { role: "user", content, timestamp: Date.now() } as AgentMessage
}

function compactionSummary(summary: string): AgentMessage {
  return {
    role: "compactionSummary",
    summary,
    tokensBefore: 1000,
    timestamp: Date.now(),
  } as AgentMessage
}

class MockPersistableAgent {
  state: { messages: AgentMessage[] }
  private listeners: Array<(event: AgentEvent) => void> = []

  constructor(messages: AgentMessage[] = []) {
    this.state = { messages }
  }

  subscribe(fn: (event: AgentEvent) => void): () => void {
    this.listeners.push(fn)
    return () => {
      this.listeners = this.listeners.filter((listener) => listener !== fn)
    }
  }

  emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}

describe("SessionManager", () => {
  test("appends entries and rebuilds context", async () => {
    const root = join(tmpdir(), `misuzu-persistence-test-${Date.now()}`)
    const sessionPath = join(root, "session.jsonl")
    await mkdir(root, { recursive: true })

    const manager = new SessionManager(sessionPath)
    const msg = userMessage("hello")
    manager.appendMessage(msg)
    manager.appendCompaction("old summary", 1234)
    manager.appendToolCall("bash", { command: "echo hello" }, "start")

    const entries = manager.readAll()
    expect(entries.length).toBe(3)
    expect(entries[0].type).toBe("message")
    expect(entries[1].type).toBe("compaction")
    expect(entries[2].type).toBe("tool_call")

    const context = manager.buildContext()
    expect(context.length).toBe(2)
    expect(context[0].role).toBe("user")
    expect(context[1].role).toBe("compactionSummary")

    manager.close()
    await rm(root, { recursive: true, force: true })
  })
})

describe("AgentSessionRecorder", () => {
  test("persists new messages and avoids duplicates", async () => {
    const root = join(tmpdir(), `misuzu-persistence-test-${Date.now()}`)
    const sessionPath = join(root, "session.jsonl")
    await mkdir(root, { recursive: true })

    const manager = new SessionManager(sessionPath)
    const initial = [userMessage("first")]
    const agent = new MockPersistableAgent(initial)
    const recorder = new AgentSessionRecorder(manager)

    const detach = recorder.attach(agent)
    expect(manager.readAll().length).toBe(1)

    // Same message should not be duplicated.
    recorder.flush(agent.state.messages)
    expect(manager.readAll().length).toBe(1)

    const next = userMessage("second")
    const summary = compactionSummary("summary")
    agent.state.messages.push(next, summary)
    agent.emit({ type: "agent_end", messages: agent.state.messages })

    agent.emit({
      type: "tool_execution_start",
      toolName: "shell",
      args: {
        command: "curl https://example.com",
        apiKey: "secret-token",
      },
    } as AgentEvent)

    const entries = manager.readAll()
    expect(entries.length).toBe(4)
    expect(entries[1].type).toBe("message")
    expect(entries[2].type).toBe("compaction")
    expect(entries[3].type).toBe("tool_call")
    if (entries[3].type === "tool_call") {
      expect(entries[3].toolName).toBe("shell")
      expect(entries[3].status).toBe("start")
      expect(entries[3].args).toEqual({
        command: "curl https://example.com",
        apiKey: "[REDACTED]",
      })
    }

    detach()
    manager.close()
    await rm(root, { recursive: true, force: true })
  })
})

describe("CompetitionPersistence", () => {
  test("creates workspace files and solver subdirectories", async () => {
    const workspaceRoot = join(tmpdir(), `misuzu-persistence-test-${Date.now()}`)
    const workspacesRoot = defaultWorkspacesRoot(workspaceRoot)
    const id = createWorkspaceId("spring ctf", new Date("2026-03-27T00:00:00Z"))

    const persistence = CompetitionPersistence.create(workspacesRoot, {
      id,
      name: "Spring CTF",
      platformUrl: "https://ctf.example.com",
      modelPool: ["rightcode/gpt-5.4"],
      createdAt: "2026-03-27T00:00:00.000Z",
    })

    expect(existsSync(join(workspacesRoot, id, "manifest.json"))).toBe(true)
    persistence.saveCoordinatorState({ queueLength: 1 })
    expect(persistence.loadCoordinatorState<{ queueLength: number }>()?.queueLength).toBe(1)

    const localAttachment = join(workspaceRoot, "attachment.txt")
    await mkdir(workspaceRoot, { recursive: true })
    await writeFile(localAttachment, "attachment content", "utf-8")

    const solverWorkspace = await persistence.ensureSolverWorkspace({
      solverId: "challenge-1",
      challengeName: "Warmup",
      category: "misc",
      description: "Solve warmup challenge",
      files: ["attachment.txt"],
      launchDir: workspaceRoot,
      model: "rightcode/gpt-5.4",
    })

    expect(existsSync(solverWorkspace.environmentPath)).toBe(true)
    expect(existsSync(join(solverWorkspace.attachmentsDir, "attachment.txt"))).toBe(true)
    expect(existsSync(solverWorkspace.platformPollScriptPath)).toBe(true)
    expect(existsSync(join(solverWorkspace.scriptsDir, "README.md"))).toBe(true)
    expect(existsSync(solverWorkspace.writeupPath)).toBe(true)

    const pollScript = await readFile(solverWorkspace.platformPollScriptPath, "utf-8")
    expect(pollScript).toContain("NOT for refreshing challenge instance URLs")
    expect(pollScript).toContain("platform-announcements.queue.md")

    const scriptsReadme = await readFile(join(solverWorkspace.scriptsDir, "README.md"), "utf-8")
    expect(scriptsReadme).toContain("platform-announcements.queue.md")
    expect(scriptsReadme).toContain("notify_coordinator(kind=environment_expired)")

    solverWorkspace.session.appendMessage(userMessage("resume me"))
    persistence.appendSolverEnvironmentNote("challenge-1", "Remote URL expired")
    persistence.updateSolverEnvironmentUrl(
      "challenge-1",
      "https://ctf.example.com/env/1",
      "2026-03-27",
    )
    persistence.appendSolverWriteup("challenge-1", "## Repro Steps\n1. run script")

    const manifest = persistence.readManifest()
    expect(manifest.solverIds).toContain("challenge-1")

    persistence.close()

    const persistedManifest = JSON.parse(
      await readFile(join(workspacesRoot, id, "manifest.json"), "utf-8"),
    ) as { id: string; name: string }
    expect(persistedManifest.id).toBe(id)
    expect(persistedManifest.name).toBe("Spring CTF")

    const envContent = await readFile(
      join(workspacesRoot, id, "coordinator", "solvers", "challenge-1", "ENVIRONMENT.md"),
      "utf-8",
    )
    expect(envContent).toContain("current url: https://ctf.example.com/env/1")
    expect(envContent).toContain("Remote URL expired")

    await rm(workspaceRoot, { recursive: true, force: true })
  })
})
