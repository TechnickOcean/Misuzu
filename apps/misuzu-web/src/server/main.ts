import { serve } from "@hono/node-server"
import { ServiceContainer } from "./di/container.ts"
import { createServerApp } from "./app.ts"
import {
  eventBusToken,
  workspaceManagerToken,
  workspaceRegistryStoreToken,
} from "./domain/tokens.ts"
import { EventBus } from "./services/event-bus.ts"
import { WorkspaceManager } from "./services/workspace-manager.ts"
import { WorkspaceRegistryStore } from "./services/workspace-registry-store.ts"

const container = new ServiceContainer()

container.registerSingleton(workspaceRegistryStoreToken, () => new WorkspaceRegistryStore())
container.registerSingleton(eventBusToken, () => new EventBus())
container.registerSingleton(workspaceManagerToken, (current) => {
  return new WorkspaceManager(
    current.resolve(workspaceRegistryStoreToken),
    current.resolve(eventBusToken),
  )
})

const manager = container.resolve(workspaceManagerToken)
await manager.initialize()

const { app, injectWebSocket } = createServerApp({
  manager,
  events: container.resolve(eventBusToken),
})

const port = Number(process.env.MISUZU_WEB_PORT ?? 8787)
const server = serve({ fetch: app.fetch, port })
injectWebSocket(server)

console.log(`Misuzu web backend listening on http://localhost:${String(port)}`)
