import { Hono } from "hono"
import type {
  OAuthLoginManualCodeRequest,
  OAuthLoginStartRequest,
  RuntimeConfigUpdateRequest,
  PromptRequest,
  RuntimeCreateRequest,
  RuntimeDequeueRequest,
  RuntimeDispatchRequest,
  RuntimeEnqueueRequest,
  RuntimeInitRequest,
  RuntimeBlockSolverRequest,
  RuntimeMarkSolvedRequest,
  RuntimeModelPoolUpdateRequest,
  RuntimeResetSolverRequest,
  RuntimeUnblockSolverRequest,
  ProviderConfigEntry,
  SolverCreateRequest,
  WorkspaceDeleteRequest,
} from "../../shared/protocol.ts"
import { WorkspaceManager } from "../services/workspace-manager.ts"

export function registerApiRoutes(app: Hono, manager: WorkspaceManager) {
  const api = new Hono()

  api.get("/workspaces", (c) => {
    return c.json({ entries: manager.listRegistryEntries() })
  })

  api.delete("/workspaces/:workspaceId", async (c) => {
    let request: WorkspaceDeleteRequest = {}
    try {
      request = await c.req.json<WorkspaceDeleteRequest>()
    } catch {
      request = {}
    }

    const removed = await manager.deleteWorkspace(c.req.param("workspaceId"), request)
    return c.json({ removed })
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

  api.get("/workspaces/runtime/:workspaceId/writeups/export", async (c) => {
    const exportData = await manager.exportRuntimeWriteups(c.req.param("workspaceId"))
    return c.json({ exportData })
  })

  api.post("/workspaces/runtime/:workspaceId/queue/enqueue", async (c) => {
    const request = await c.req.json<RuntimeEnqueueRequest>()
    const snapshot = await manager.enqueueRuntimeChallenge(
      c.req.param("workspaceId"),
      Number(request.challengeId),
    )
    return c.json({ snapshot })
  })

  api.post("/workspaces/runtime/:workspaceId/queue/dequeue", async (c) => {
    const request = await c.req.json<RuntimeDequeueRequest>()
    const snapshot = await manager.dequeueRuntimeChallenge(
      c.req.param("workspaceId"),
      Number(request.challengeId),
    )
    return c.json({ snapshot })
  })

  api.post("/workspaces/runtime/:workspaceId/solver/reset", async (c) => {
    const request = await c.req.json<RuntimeResetSolverRequest>()
    const snapshot = await manager.resetRuntimeSolver(
      c.req.param("workspaceId"),
      Number(request.challengeId),
    )
    return c.json({ snapshot })
  })

  api.post("/workspaces/runtime/:workspaceId/solver/block", async (c) => {
    const request = await c.req.json<RuntimeBlockSolverRequest>()
    const snapshot = await manager.blockRuntimeSolver(
      c.req.param("workspaceId"),
      Number(request.challengeId),
    )
    return c.json({ snapshot })
  })

  api.post("/workspaces/runtime/:workspaceId/solver/unblock", async (c) => {
    const request = await c.req.json<RuntimeUnblockSolverRequest>()
    const snapshot = await manager.unblockRuntimeSolver(
      c.req.param("workspaceId"),
      Number(request.challengeId),
    )
    return c.json({ snapshot })
  })

  api.post("/workspaces/runtime/:workspaceId/solver/mark-solved", async (c) => {
    const request = await c.req.json<RuntimeMarkSolvedRequest>()
    const snapshot = await manager.markRuntimeSolverSolved(
      c.req.param("workspaceId"),
      Number(request.challengeId),
      request.writeupMarkdown,
    )
    return c.json({ snapshot })
  })

  api.get("/workspaces/runtime/:workspaceId/settings", async (c) => {
    const settings = await manager.getRuntimeSettings(c.req.param("workspaceId"))
    return c.json({ settings })
  })

  api.post("/workspaces/runtime/:workspaceId/settings/provider-config", async (c) => {
    const request = await c.req.json<{ providerConfig: ProviderConfigEntry[] }>()
    const snapshot = await manager.updateRuntimeProviderConfig(
      c.req.param("workspaceId"),
      request.providerConfig,
    )
    return c.json({ snapshot })
  })

  api.post("/workspaces/runtime/:workspaceId/settings/runtime-config", async (c) => {
    const request = await c.req.json<RuntimeConfigUpdateRequest>()
    const snapshot = await manager.updateRuntimeConfig(c.req.param("workspaceId"), request)
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

  api.get("/workspaces/runtime/:workspaceId/agents/:agentId/writeup", async (c) => {
    const writeup = await manager.getRuntimeAgentWriteup(
      c.req.param("workspaceId"),
      c.req.param("agentId"),
    )
    return c.json({ writeup })
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

  api.get("/providers/catalog", async (c) => {
    const workspaceId = c.req.query("workspaceId")
    const items = await manager.listProviderCatalog(workspaceId)
    return c.json({ items })
  })

  api.get("/providers/oauth", (c) => {
    c.header("Cache-Control", "no-store")
    return c.json({ providers: manager.listOAuthProviders() })
  })

  api.post("/providers/oauth/login", async (c) => {
    c.header("Cache-Control", "no-store")
    const request = await c.req.json<OAuthLoginStartRequest>()
    const session = await manager.startOAuthLogin(request.provider)
    return c.json({ session })
  })

  api.get("/providers/oauth/login/:sessionId", async (c) => {
    c.header("Cache-Control", "no-store")
    const session = manager.getOAuthLoginSession(c.req.param("sessionId"))
    return c.json({ session })
  })

  api.post("/providers/oauth/login/:sessionId/manual-code", async (c) => {
    c.header("Cache-Control", "no-store")
    const request = await c.req.json<OAuthLoginManualCodeRequest>()
    const session = manager.submitOAuthManualCode(c.req.param("sessionId"), request.code)
    return c.json({ session })
  })

  api.get("/plugins/:pluginId/readme", async (c) => {
    const readme = await manager.getPluginReadme(c.req.param("pluginId"))
    return c.json(readme)
  })

  app.route("/api", api)
}
