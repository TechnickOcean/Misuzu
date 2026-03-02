import * as fs from "node:fs/promises"
import * as path from "node:path"
import { zValidator } from "@hono/zod-validator"
import type { ServerWebSocket } from "bun"
import * as Bun from "bun"
import { Hono } from "hono"
import { z } from "zod"
import { runEnvAgent } from "@/agents/EnvAgent"
import { getDBWorkspace, listDBWorkspaces, updateDBWorkspace } from "@/tools/workspace/core/db"

const app = new Hono()
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
  return c.json({
    id: workspace?.id,
    title: workspace?.title,
    path: workspace?.path,
    store: workspace?.store ?? null
  })
})

app.get("/api/workspaces", async (c) => {
  const workspaces = await listDBWorkspaces()
  return c.json(
    workspaces.map((workspace) => ({
      id: workspace.id,
      title: workspace.title,
      path: workspace.path,
      store: workspace.store ?? null
    }))
  )
})

app.post("/api/workspaces/:id/switch", async (c) => {
  const id = Number(c.req.param("id"))
  const workspace = await getDBWorkspace({ id })
  if (!workspace) return c.json({ error: "Workspace not found" }, 404)
  await updateDBWorkspace({
    id,
    data: {
      store: {
        ...(workspace.store as Record<string, unknown>),
        status: "running",
        current_step: "active"
      }
    }
  })
  await broadcastWorkspaces()
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
let server: ReturnType<typeof Bun.serve>

server = Bun.serve({
  port: 3001,
  fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === "/ws") {
      if (server.upgrade(req, { data: undefined })) return
      return new Response("Upgrade required", { status: 426 })
    }
    return app.fetch(req, undefined as never)
  },
  websocket: {
    open(ws) {
      sockets.add(ws as ServerWebSocket<undefined>)
      broadcastWorkspaces().catch(() => {})
    },
    close(ws) {
      sockets.delete(ws as ServerWebSocket<undefined>)
    },
    message() {}
  }
})

async function broadcastWorkspaces() {
  const workspaces = await listDBWorkspaces()
  const payload = JSON.stringify({
    type: "workspaces",
    data: workspaces.map((workspace) => ({
      id: workspace.id,
      title: workspace.title,
      path: workspace.path,
      store: workspace.store ?? null
    }))
  })
  for (const ws of sockets) {
    ws.send(payload)
  }
}
