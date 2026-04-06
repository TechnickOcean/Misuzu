import { Hono } from "hono"
import type {
  PromptRequest,
  RuntimeCreateRequest,
  RuntimeDispatchRequest,
  RuntimeEnqueueRequest,
  RuntimeInitRequest,
  RuntimeModelPoolUpdateRequest,
  SolverCreateRequest,
} from "../../shared/protocol.ts"
import { WorkspaceManager } from "../services/workspace-manager.ts"

export function registerApiRoutes(app: Hono, manager: WorkspaceManager) {
  const api = new Hono()

  api.get("/workspaces", (c) => {
    return c.json({ entries: manager.listRegistryEntries() })
  })

  api.post("/workspaces/runtime", async (c) => {
    const request = await c.req.json<RuntimeCreateRequest>()
    const snapshot = await manager.createRuntimeWorkspace(request)
    return c.json({ snapshot })
  })

  api.get("/workspaces/runtime/:workspaceId", async (c) => {
    const snapshot = await manager.getRuntimeSnapshot(c.req.param("workspaceId"))
    return c.json({ snapshot })
  })

  api.post("/workspaces/runtime/:workspaceId/runtime/init", async (c) => {
    const request = await c.req.json<RuntimeInitRequest>()
    const snapshot = await manager.initializeRuntime(c.req.param("workspaceId"), request)
    return c.json({ snapshot })
  })

  api.post("/workspaces/runtime/:workspaceId/dispatch/start", async (c) => {
    let request: RuntimeDispatchRequest = {}
    try {
      request = await c.req.json<RuntimeDispatchRequest>()
    } catch {
      request = {}
    }

    const snapshot = await manager.setRuntimeDispatch(
      c.req.param("workspaceId"),
      false,
      Boolean(request.autoEnqueue),
    )
    return c.json({ snapshot })
  })

  api.post("/workspaces/runtime/:workspaceId/dispatch/pause", async (c) => {
    const snapshot = await manager.setRuntimeDispatch(c.req.param("workspaceId"), true, false)
    return c.json({ snapshot })
  })

  api.post("/workspaces/runtime/:workspaceId/model-pool", async (c) => {
    const request = await c.req.json<RuntimeModelPoolUpdateRequest>()
    const snapshot = await manager.updateRuntimeModelPool(
      c.req.param("workspaceId"),
      request.modelPool,
    )
    return c.json({ snapshot })
  })

  api.post("/workspaces/runtime/:workspaceId/sync/challenges", async (c) => {
    const snapshot = await manager.syncRuntimeChallenges(c.req.param("workspaceId"))
    return c.json({ snapshot })
  })

  api.post("/workspaces/runtime/:workspaceId/sync/notices", async (c) => {
    const snapshot = await manager.syncRuntimeNotices(c.req.param("workspaceId"))
    return c.json({ snapshot })
  })

  api.post("/workspaces/runtime/:workspaceId/queue/enqueue", async (c) => {
    const request = await c.req.json<RuntimeEnqueueRequest>()
    const snapshot = await manager.enqueueRuntimeChallenge(
      c.req.param("workspaceId"),
      Number(request.challengeId),
    )
    return c.json({ snapshot })
  })

  api.post("/workspaces/runtime/:workspaceId/agents/environment", async (c) => {
    const snapshot = await manager.ensureRuntimeEnvironmentAgent(c.req.param("workspaceId"))
    return c.json({ snapshot })
  })

  api.get("/workspaces/runtime/:workspaceId/agents/:agentId/state", async (c) => {
    const state = await manager.getRuntimeAgentState(
      c.req.param("workspaceId"),
      c.req.param("agentId"),
    )
    return c.json({ state })
  })

  api.post("/workspaces/runtime/:workspaceId/agents/:agentId/prompt", async (c) => {
    const request = await c.req.json<PromptRequest>()
    const state = await manager.promptRuntimeAgent(
      c.req.param("workspaceId"),
      c.req.param("agentId"),
      request.prompt,
      request.mode,
    )
    return c.json({ state })
  })

  api.post("/workspaces/solver", async (c) => {
    const request = await c.req.json<SolverCreateRequest>()
    const snapshot = await manager.createSolverWorkspace(request)
    return c.json({ snapshot })
  })

  api.get("/workspaces/solver/:workspaceId", async (c) => {
    const snapshot = await manager.getSolverSnapshot(c.req.param("workspaceId"))
    return c.json({ snapshot })
  })

  api.get("/workspaces/solver/:workspaceId/agent/state", async (c) => {
    const state = await manager.getSolverAgentState(c.req.param("workspaceId"))
    return c.json({ state })
  })

  api.post("/workspaces/solver/:workspaceId/prompt", async (c) => {
    const request = await c.req.json<PromptRequest>()
    const state = await manager.promptSolver(
      c.req.param("workspaceId"),
      request.prompt,
      request.mode,
    )
    return c.json({ state })
  })

  api.get("/plugins", (c) => {
    const query = c.req.query("query")
    return c.json({ items: manager.listPlugins(query) })
  })

  api.get("/plugins/:pluginId/readme", async (c) => {
    const readme = await manager.getPluginReadme(c.req.param("pluginId"))
    return c.json(readme)
  })

  app.route("/api", api)
}
