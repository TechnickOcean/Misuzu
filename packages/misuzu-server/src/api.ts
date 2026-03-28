import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import type { RuntimeCommandRequest, RuntimeEventEnvelope } from "./protocol.ts"
import type { RuntimeHost } from "./runtime-host.ts"

export interface MisuzuApiOptions {
  authToken?: string
  sseHeartbeatMs?: number
}

export function createMisuzuApi(runtime: RuntimeHost, options: MisuzuApiOptions = {}) {
  const app = new Hono()
  const heartbeatMs = Math.max(5000, options.sseHeartbeatMs ?? 15000)

  app.use("*", async (c, next) => {
    if (!options.authToken) {
      await next()
      return
    }

    const token =
      c.req.header("x-misuzu-token") ?? c.req.header("authorization")?.replace(/^Bearer\s+/i, "")

    if (token !== options.authToken) {
      return c.json({ ok: false, error: "unauthorized" }, 401)
    }

    await next()
  })

  app.get("/health", (c) => {
    const snapshot = runtime.getSnapshot()
    return c.json({
      ok: true,
      protocolVersion: snapshot.protocolVersion,
      coordinatorStatus: snapshot.coordinatorStatus,
      workspaceId: snapshot.workspaceId,
      generatedAt: new Date().toISOString(),
    })
  })

  app.get("/workspaces", (c) => {
    return c.json({ ok: true, workspaces: runtime.listWorkspaces() })
  })

  app.get("/runtime/snapshot", (c) => {
    return c.json(runtime.getSnapshot())
  })

  app.post("/runtime/command", async (c) => {
    const request = await c.req.json<RuntimeCommandRequest>().catch(() => undefined)
    if (!request || typeof request.command !== "string") {
      return c.json({ ok: false, error: "invalid command payload" }, 400)
    }

    try {
      const result = await runtime.executeCommand(request)
      return c.json(result, result.ok ? 200 : 400)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return c.json({ ok: false, requestId: request.requestId, error: message }, 500)
    }
  })

  app.get("/runtime/events", async (c) => {
    const after = parseAfterSeq(c.req.query("after"))
    const backlog = runtime.getEventsSince(after)

    return streamSSE(c, async (stream) => {
      for (const event of backlog) {
        await writeEvent(stream.writeSSE.bind(stream), event)
      }

      const unsubscribe = runtime.subscribeEvents((event) => {
        void writeEvent(stream.writeSSE.bind(stream), event)
      })

      const interval = setInterval(() => {
        void stream.writeSSE({
          event: "heartbeat",
          data: JSON.stringify({ ts: new Date().toISOString() }),
        })
      }, heartbeatMs)

      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          clearInterval(interval)
          unsubscribe()
          resolve()
        })
      })
    })
  })

  return app
}

function parseAfterSeq(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 0) return undefined
  return parsed
}

async function writeEvent(
  writeSSE: (message: { id?: string; event?: string; data: string }) => Promise<void>,
  event: RuntimeEventEnvelope,
) {
  await writeSSE({
    id: String(event.seq),
    event: event.type,
    data: JSON.stringify(event),
  })
}
