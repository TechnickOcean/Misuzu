import * as fs from "node:fs/promises"
import * as path from "node:path"
import { zValidator } from "@hono/zod-validator"
import type { ServerWebSocket } from "bun"
import * as Bun from "bun"
import { Hono } from "hono"
import { upgradeWebSocket, websocket } from "hono/bun"
import { z } from "zod"
import { runAgentHiro } from "@/agents/AgentHiro"
import { readAgentState } from "@/agents/base/agentState"
import { runCTFAgent } from "@/agents/CTFAgent"
import { runEnvAgent } from "@/agents/EnvAgent"
import { getDBWorkspace, listDBWorkspaces, updateDBWorkspace } from "@/tools/workspace/core/db"

const app = new Hono()
const agentControllers = new Map<number, { stop: boolean; running: boolean }>()
app.use("*", async (c, next) => {
  c.header("Access-Control-Allow-Origin", "http://localhost:5173")
  c.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
  c.header("Access-Control-Allow-Headers", "Content-Type")
  if (c.req.method === "OPTIONS") return c.body(null, 204)
  await next()
})

const createWorkspaceSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  hints: z.array(z.string()).default([]),
  remote_url: z.string().optional(),
  type: z.enum(["whitebox", "blackbox", "graybox"]).default("whitebox")
})

app.post(
  "/api/workspaces",
  zValidator("json", createWorkspaceSchema, (result, c) => {
    if (!result.success) return c.json({ error: "Invalid payload" }, 400)
  }),
  async (c) => {
    const body = c.req.valid("json")
    const result = await runEnvAgent({
      title: body.title,
      description: body.description,
      hints: body.hints,
      remote_url: body.remote_url ?? null
    })
    await broadcastWorkspaces()
    return c.json(result)
  }
)

app.get("/api/workspaces/:id", async (c) => {
  const id = Number(c.req.param("id"))
  const workspace = await getDBWorkspace({ id })
  const agentState = workspace?.path ? await readAgentState(workspace.path) : null
  return c.json({
    id: workspace?.id,
    title: workspace?.title,
    path: workspace?.path,
    store: workspace?.store ?? null,
    agent_state: agentState,
    is_running: agentControllers.get(id)?.running ?? false
  })
})

app.get("/api/workspaces", async (c) => {
  const workspaces = await listDBWorkspaces()
  return c.json(
    await Promise.all(
      workspaces.map(async (workspace) => ({
        id: workspace.id,
        title: workspace.title,
        path: workspace.path,
        store: workspace.store ?? null,
        agent_state: workspace.path ? await readAgentState(workspace.path) : null,
        is_running: agentControllers.get(workspace.id)?.running ?? false
      }))
    )
  )
})

app.post("/api/workspaces/:id/switch", async (c) => {
  const id = Number(c.req.param("id"))
  const workspace = await getDBWorkspace({ id })
  if (!workspace) return c.json({ error: "Workspace not found" }, 404)
  const store = (workspace.store as Record<string, unknown> | null) ?? {}
  await updateDBWorkspace({
    id,
    data: {
      store: {
        ...store,
        current_step: "active"
      }
    }
  })
  await broadcastWorkspaces()
  return c.json({ ok: true })
})

const agentStartSchema = z.object({
  model: z.enum(["glm-4.7-flash", "llama-4-scout-17b-16e-instruct", "qwen3-30b-a3b-fp8"]),
  type: z.enum(["ctf", "hiro"]).default("ctf"),
  questions: z.array(z.string()).default([])
})

app.post(
  "/api/workspaces/:id/agent/start",
  zValidator("json", agentStartSchema, (result, c) => {
    if (!result.success) return c.json({ error: "Invalid payload" }, 400)
  }),
  async (c) => {
    const id = Number(c.req.param("id"))
    const workspace = await getDBWorkspace({ id })
    if (!workspace) return c.json({ error: "Workspace not found" }, 404)

    if (!agentControllers.has(id)) {
      agentControllers.set(id, { stop: false, running: false })
    }
    const controller = agentControllers.get(id)
    if (!controller) return c.json({ error: "Agent controller unavailable" }, 500)
    if (controller.running) return c.json({ error: "Agent already running" }, 409)

    controller.stop = false
    controller.running = true

    const payload = c.req.valid("json")
    const notify = (event: { type: string; [key: string]: unknown }) => {
      const message = JSON.stringify({ type: "agent_event", workspace_id: id, data: event })
      for (const ws of sockets) ws.send(message)
    }

    const shouldStop = () => controller.stop

    if (payload.type === "hiro") {
      const questions = payload.questions.length ? payload.questions : ["Provide missing knowledge."]
      runAgentHiro({ workspace_id: id, model: payload.model, questions }, { onEvent: notify, shouldStop }).finally(
        () => {
          controller.running = false
        }
      )
    } else {
      runCTFAgent({ workspace_id: id, model: payload.model }, { onEvent: notify, shouldStop }).finally(() => {
        controller.running = false
      })
    }

    return c.json({ ok: true })
  }
)

app.post("/api/workspaces/:id/agent/stop", async (c) => {
  const id = Number(c.req.param("id"))
  const controller = agentControllers.get(id)
  if (!controller) return c.json({ error: "Agent not started" }, 404)
  controller.stop = true
  return c.json({ ok: true })
})

const uploadSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  hints: z.array(z.string()).default([]),
  remote_url: z.string().optional()
})

app.post("/api/workspaces/with-attachments", async (c) => {
  const formData = await c.req.formData()
  const payloadRaw = formData.get("payload")
  if (!payloadRaw || typeof payloadRaw !== "string") {
    return c.json({ error: "payload is required" }, 400)
  }
  const payload = uploadSchema.parse(JSON.parse(payloadRaw))
  const files = formData.getAll("files")
  const attachments: string[] = []

  for (const file of files) {
    if (file instanceof File) {
      const buffer = Buffer.from(await file.arrayBuffer())
      const uploadDir = path.join("tmp", "uploads")
      await fs.mkdir(uploadDir, { recursive: true })
      const tempPath = path.join(uploadDir, `${crypto.randomUUID()}-${file.name}`)
      await Bun.write(tempPath, buffer)
      attachments.push(tempPath)
    }
  }

  const result = await runEnvAgent({
    title: payload.title,
    description: payload.description,
    hints: payload.hints,
    remote_url: payload.remote_url ?? null,
    attachments
  })
  await broadcastWorkspaces()
  return c.json(result)
})

app.get("/healthz", (c) => c.text("ok"))

const sockets = new Set<ServerWebSocket<undefined>>()

app.get(
  "/ws",
  upgradeWebSocket((_c) => {
    return {
      onOpen(_event, ws) {
        if (ws.raw) {
          sockets.add(ws.raw as ServerWebSocket<undefined>)
          broadcastWorkspaces().catch(() => {})
        }
      },
      onClose(_event, ws) {
        if (ws.raw) {
          sockets.delete(ws.raw as ServerWebSocket<undefined>)
        }
      }
    }
  })
)

Bun.serve({
  port: 3001,
  fetch: app.fetch,
  websocket
})

async function broadcastWorkspaces() {
  const workspaces = await listDBWorkspaces()
  const payload = JSON.stringify({
    type: "workspaces",
    data: await Promise.all(
      workspaces.map(async (workspace) => ({
        id: workspace.id,
        title: workspace.title,
        path: workspace.path,
        store: workspace.store ?? null,
        agent_state: workspace.path ? await readAgentState(workspace.path) : null,
        is_running: agentControllers.get(workspace.id)?.running ?? false
      }))
    )
  })
  for (const ws of sockets) {
    ws.send(payload)
  }
}
