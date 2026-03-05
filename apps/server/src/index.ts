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
import { addCTFConversation, compactCTFContext, pauseCTFAgent, runCTFAgent } from "@/agents/CTFAgent"
import { runEnvAgent } from "@/agents/EnvAgent"
import { deleteWorkspace, getWorkspace, listWorkspaces } from "@/tools/workspace/core/manager"

const app = new Hono()
const agentControllers = new Map<string, { stop: boolean; running: boolean }>()
app.use("*", async (c, next) => {
  c.header("Access-Control-Allow-Origin", "http://localhost:5173")
  c.header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
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
  const id = c.req.param("id")
  let workspace: Awaited<ReturnType<typeof getWorkspace>>
  try {
    workspace = await getWorkspace({ id })
  } catch {
    return c.json({ error: "Workspace not found" }, 404)
  }
  const agentState = workspace.path ? await readAgentState(workspace.path) : null
  const stats = workspace.path ? await getWorkspaceStats(workspace.path) : undefined

  return c.json({
    id: workspace.id,
    title: workspace.title,
    path: workspace.path,
    agent_state: agentState,
    is_running: agentControllers.get(id)?.running ?? false,
    stats
  })
})

app.get("/api/workspaces", async (c) => {
  const workspaces = await listWorkspaces()
  return c.json(
    await Promise.all(
      workspaces.map(async (workspace) => {
        const stats = workspace.path ? await getWorkspaceStats(workspace.path) : undefined
        return {
          id: workspace.id,
          title: workspace.title,
          path: workspace.path,
          agent_state: workspace.path ? await readAgentState(workspace.path) : null,
          is_running: agentControllers.get(workspace.id)?.running ?? false,
          stats
        }
      })
    )
  )
})

app.post("/api/workspaces/:id/switch", async (c) => {
  const id = c.req.param("id")
  try {
    await getWorkspace({ id })
  } catch {
    return c.json({ error: "Workspace not found" }, 404)
  }
  await broadcastWorkspaces()
  return c.json({ ok: true })
})

app.delete("/api/workspaces/:id", async (c) => {
  const id = c.req.param("id")
  try {
    await deleteWorkspace({ id })
  } catch {
    return c.json({ error: "Workspace not found" }, 404)
  }
  agentControllers.delete(id)
  await broadcastWorkspaces()
  return c.json({ ok: true })
})

app.get("/api/workspaces/:id/files", async (c) => {
  const id = c.req.param("id")
  let workspace: Awaited<ReturnType<typeof getWorkspace>>
  try {
    workspace = await getWorkspace({ id })
  } catch {
    return c.json({ error: "Workspace not found" }, 404)
  }

  try {
    const files = await listFilesRecursive(workspace.path)
    return c.json(files)
  } catch (_err) {
    return c.json({ error: "Failed to list files" }, 500)
  }
})

app.get("/api/workspaces/:id/files/*", async (c) => {
  const id = c.req.param("id")
  const filepath = c.req.path.replace(`/api/workspaces/${id}/files/`, "")

  let workspace: Awaited<ReturnType<typeof getWorkspace>>
  try {
    workspace = await getWorkspace({ id })
  } catch {
    return c.json({ error: "Workspace not found" }, 404)
  }

  const fullPath = path.join(workspace.path, filepath)
  if (!fullPath.startsWith(workspace.path)) {
    return c.json({ error: "Invalid path" }, 403)
  }

  try {
    const stat = await fs.stat(fullPath)
    if (stat.isDirectory()) {
      return c.json({ error: "Path is a directory" }, 400)
    }
    const content = await fs.readFile(fullPath, "utf-8")
    return c.text(content)
  } catch {
    return c.json({ error: "File not found" }, 404)
  }
})

async function getWorkspaceStats(path: string) {
  try {
    const files = await listFilesRecursive(path)
    return {
      findings_count: files.filter((f) => /finding|writeup|flag/i.test(f.path)).length,
      knowledge_count: files.filter((f) => /knowledge|note/i.test(f.path)).length,
      files_count: files.filter((f) => f.type === "file").length
    }
  } catch {
    return { findings_count: 0, knowledge_count: 0, files_count: 0 }
  }
}

async function listFilesRecursive(dir: string, baseDir = dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const results: { path: string; name: string; type: "file" | "dir"; size?: number; updated_at?: string }[] = []

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    const relativePath = path.relative(baseDir, fullPath)

    // Skip hidden files/dirs (like .misuzu) and node_modules
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue

    if (entry.isDirectory()) {
      results.push({
        path: relativePath,
        name: entry.name,
        type: "dir"
      })
      const subFiles = await listFilesRecursive(fullPath, baseDir)
      results.push(...subFiles)
    } else {
      const stat = await fs.stat(fullPath)
      results.push({
        path: relativePath,
        name: entry.name,
        type: "file",
        size: stat.size,
        updated_at: stat.mtime.toISOString()
      })
    }
  }
  return results
}

const agentStartSchema = z.object({
  model: z.enum(["glm-4.7-flash", "llama-4-scout-17b-16e-instruct", "qwen3-30b-a3b-fp8"]),
  type: z.enum(["ctf", "hiro"]).default("ctf"),
  questions: z.array(z.string()).default([])
})

const agentActionSchema = z.object({
  action: z.enum(["pause", "dialogue", "compact", "file_read", "file_write", "file_edit", "file_delete"]),
  model: z.optional(z.enum(["glm-4.7-flash", "llama-4-scout-17b-16e-instruct", "qwen3-30b-a3b-fp8"])),
  prompt: z.optional(z.string()),
  file_path: z.optional(z.string()),
  content: z.optional(z.string()),
  old_content: z.optional(z.string()),
  new_content: z.optional(z.string())
})

app.post(
  "/api/workspaces/:id/agent/start",
  zValidator("json", agentStartSchema, (result, c) => {
    if (!result.success) return c.json({ error: "Invalid payload" }, 400)
  }),
  async (c) => {
    const id = c.req.param("id")
    try {
      await getWorkspace({ id })
    } catch {
      return c.json({ error: "Workspace not found" }, 404)
    }

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
  const id = c.req.param("id")
  const controller = agentControllers.get(id)
  if (!controller) return c.json({ error: "Agent not started" }, 404)
  controller.stop = true
  return c.json({ ok: true })
})

app.post(
  "/api/workspaces/:id/agent/action",
  zValidator("json", agentActionSchema, (result, c) => {
    if (!result.success) return c.json({ error: "Invalid payload" }, 400)
  }),
  async (c) => {
    const id = c.req.param("id")
    let workspace: Awaited<ReturnType<typeof getWorkspace>>
    try {
      workspace = await getWorkspace({ id })
    } catch {
      return c.json({ error: "Workspace not found" }, 404)
    }

    const payload = c.req.valid("json")
    const fullPath = payload.file_path ? path.join(workspace.path, payload.file_path) : null
    if (fullPath && !fullPath.startsWith(workspace.path)) {
      return c.json({ error: "Invalid path" }, 403)
    }

    switch (payload.action) {
      case "pause": {
        await pauseCTFAgent({ workspace_id: id })
        await broadcastWorkspaces()
        return c.json({ ok: true })
      }
      case "dialogue": {
        if (!payload.prompt?.trim()) return c.json({ error: "prompt is required" }, 400)
        await addCTFConversation({ workspace_id: id, prompt: payload.prompt })
        await broadcastWorkspaces()
        return c.json({ ok: true })
      }
      case "compact": {
        if (!payload.model) return c.json({ error: "model is required" }, 400)
        await compactCTFContext({ workspace_id: id, model: payload.model })
        await broadcastWorkspaces()
        return c.json({ ok: true })
      }
      case "file_read": {
        if (!payload.file_path) return c.json({ error: "file_path is required" }, 400)
        try {
          const content = await fs.readFile(fullPath!, "utf-8")
          return c.text(content)
        } catch {
          return c.json({ error: "File not found" }, 404)
        }
      }
      case "file_write": {
        if (!payload.file_path) return c.json({ error: "file_path is required" }, 400)
        if (payload.content === undefined) return c.json({ error: "content is required" }, 400)
        try {
          await fs.mkdir(path.dirname(fullPath!), { recursive: true })
          await fs.writeFile(fullPath!, payload.content, "utf-8")
          await broadcastWorkspaces()
          return c.json({ ok: true })
        } catch {
          return c.json({ error: "Write failed" }, 500)
        }
      }
      case "file_edit": {
        if (!payload.file_path) return c.json({ error: "file_path is required" }, 400)
        if (payload.old_content === undefined || payload.new_content === undefined)
          return c.json({ error: "old_content and new_content are required" }, 400)
        try {
          const content = await fs.readFile(fullPath!, "utf-8")
          if (!content.includes(payload.old_content)) {
            return c.json({ error: "old_content not found" }, 404)
          }
          await fs.writeFile(fullPath!, content.replace(payload.old_content, payload.new_content), "utf-8")
          await broadcastWorkspaces()
          return c.json({ ok: true })
        } catch {
          return c.json({ error: "Edit failed" }, 500)
        }
      }
      case "file_delete": {
        if (!payload.file_path) return c.json({ error: "file_path is required" }, 400)
        try {
          await fs.unlink(fullPath!)
          await broadcastWorkspaces()
          return c.json({ ok: true })
        } catch {
          return c.json({ error: "Delete failed" }, 500)
        }
      }
      default:
        return c.json({ error: "Unknown action" }, 400)
    }
  }
)

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
  const workspaces = await listWorkspaces()
  const payload = JSON.stringify({
    type: "workspaces",
    data: await Promise.all(
      workspaces.map(async (workspace) => {
        const stats = workspace.path ? await getWorkspaceStats(workspace.path) : undefined
        return {
          id: workspace.id,
          title: workspace.title,
          path: workspace.path,
          agent_state: workspace.path ? await readAgentState(workspace.path) : null,
          is_running: agentControllers.get(workspace.id)?.running ?? false,
          stats
        }
      })
    )
  })
  for (const ws of sockets) {
    ws.send(payload)
  }
}
