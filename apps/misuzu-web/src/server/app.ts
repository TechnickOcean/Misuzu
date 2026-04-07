import { Hono } from "hono"
import { createNodeWebSocket } from "@hono/node-ws"
import type { WsServerMessage } from "../shared/protocol.ts"
import { registerApiRoutes } from "./routes/api.ts"
import { WorkspaceManager } from "./services/workspace-manager.ts"
import { EventBus } from "./services/event-bus.ts"

interface ServerAppOptions {
  manager: WorkspaceManager
  events: EventBus
}

export function createServerApp(options: ServerAppOptions) {
  const app = new Hono()

  app.onError((error, c) => {
    const message = error instanceof Error ? error.message : String(error)
    return c.json({ error: message }, 400)
  })

  app.get("/health", (c) => c.json({ ok: true }))

  registerApiRoutes(app, options.manager)

  const wsRuntime = createNodeWebSocket({ app })

  app.get(
    "/ws",
    wsRuntime.upgradeWebSocket((c) => {
      const topic = c.req.query("topic")

      return {
        onOpen: (_event, ws) => {
          if (!topic) {
            sendWsMessage(ws, { type: "error", payload: { message: "Missing topic" } })
            ws.close()
            return
          }

          let unsubscribe = () => {}

          const sendMessage = (message: WsServerMessage) => {
            sendWsMessage(ws, message)
          }

          unsubscribe = options.events.subscribe(topic, sendMessage)
          ;(ws as unknown as { _misuzuUnsubscribe?: () => void })._misuzuUnsubscribe = unsubscribe

          void sendInitialTopicSnapshot(topic, options.manager, sendMessage).catch((error) => {
            sendMessage({
              type: "error",
              payload: {
                message: error instanceof Error ? error.message : String(error),
              },
            })
            unsubscribe()
            ws.close()
          })
        },
        onClose: (_event, ws) => {
          ;(ws as unknown as { _misuzuUnsubscribe?: () => void })._misuzuUnsubscribe?.()
        },
      }
    }),
  )

  return {
    app,
    injectWebSocket: (server: Parameters<typeof wsRuntime.injectWebSocket>[0]) => {
      wsRuntime.injectWebSocket(server)
    },
  }
}

function sendWsMessage(
  ws: {
    send: (data: string) => void
    close: () => void
  },
  message: WsServerMessage,
) {
  try {
    ws.send(JSON.stringify(message))
  } catch {
    ws.close()
  }
}

async function sendInitialTopicSnapshot(
  topic: string,
  manager: WorkspaceManager,
  send: (message: WsServerMessage) => void,
) {
  if (topic === "registry") {
    send({
      type: "registry.updated",
      payload: {
        entries: manager.listRegistryEntries(),
      },
    })
    return
  }

  if (topic.startsWith("runtime:")) {
    const workspaceId = topic.slice("runtime:".length)
    const snapshot = await manager.getRuntimeSnapshot(workspaceId)
    send({
      type: "runtime.snapshot",
      payload: {
        workspaceId,
        snapshot,
      },
    })
    return
  }

  if (topic.startsWith("solver:")) {
    const workspaceId = topic.slice("solver:".length)
    const snapshot = await manager.getSolverSnapshot(workspaceId)
    send({
      type: "solver.snapshot",
      payload: {
        workspaceId,
        snapshot,
      },
    })
  }
}
