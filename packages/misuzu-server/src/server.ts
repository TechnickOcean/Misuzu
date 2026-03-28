import { serve } from "@hono/node-server"
import { createMisuzuApi, type MisuzuApiOptions } from "./api.ts"
import type { RuntimeHost } from "./runtime-host.ts"

export interface MisuzuServerStartOptions extends MisuzuApiOptions {
  hostname?: string
  port?: number
}

export function startMisuzuServer(runtime: RuntimeHost, options: MisuzuServerStartOptions = {}) {
  const app = createMisuzuApi(runtime, options)
  const server = serve({
    fetch: app.fetch,
    hostname: options.hostname ?? "127.0.0.1",
    port: options.port ?? 7788,
  })

  return { app, server }
}
