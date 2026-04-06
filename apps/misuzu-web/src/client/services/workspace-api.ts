import type {
  AgentStateSnapshot,
  PluginCatalogItem,
  PluginReadmeResponse,
  PromptMode,
  RuntimeCreateRequest,
  RuntimeDispatchRequest,
  RuntimeEnqueueRequest,
  RuntimeInitRequest,
  RuntimeModelPoolUpdateRequest,
  RuntimeWorkspaceSnapshot,
  SolverCreateRequest,
  SolverWorkspaceSnapshot,
  WorkspaceRegistryEntry,
} from "../../shared/protocol.ts"

export class WorkspaceApiClient {
  constructor(private readonly baseUrl = "") {}

  async listWorkspaces() {
    const response = await this.request<{ entries: WorkspaceRegistryEntry[] }>("/api/workspaces")
    return response.entries
  }

  async listPlugins(query?: string) {
    const searchParams = new URLSearchParams()
    if (query?.trim()) {
      searchParams.set("query", query.trim())
    }

    const suffix = searchParams.toString()
    const response = await this.request<{ items: PluginCatalogItem[] }>(
      `/api/plugins${suffix ? `?${suffix}` : ""}`,
    )
    return response.items
  }

  async getPluginReadme(pluginId: string) {
    return this.request<PluginReadmeResponse>(`/api/plugins/${encodeURIComponent(pluginId)}/readme`)
  }

  async createRuntimeWorkspace(request: RuntimeCreateRequest) {
    const response = await this.request<{ snapshot: RuntimeWorkspaceSnapshot }>(
      "/api/workspaces/runtime",
      {
        method: "POST",
        body: JSON.stringify(request),
      },
    )

    return response.snapshot
  }

  async getRuntimeWorkspace(workspaceId: string) {
    const response = await this.request<{ snapshot: RuntimeWorkspaceSnapshot }>(
      `/api/workspaces/runtime/${encodeURIComponent(workspaceId)}`,
    )
    return response.snapshot
  }

  async initializeRuntime(workspaceId: string, request: RuntimeInitRequest) {
    const response = await this.request<{ snapshot: RuntimeWorkspaceSnapshot }>(
      `/api/workspaces/runtime/${encodeURIComponent(workspaceId)}/runtime/init`,
      {
        method: "POST",
        body: JSON.stringify(request),
      },
    )
    return response.snapshot
  }

  async startRuntimeDispatch(workspaceId: string, request: RuntimeDispatchRequest = {}) {
    const response = await this.request<{ snapshot: RuntimeWorkspaceSnapshot }>(
      `/api/workspaces/runtime/${encodeURIComponent(workspaceId)}/dispatch/start`,
      {
        method: "POST",
        body: JSON.stringify(request),
      },
    )
    return response.snapshot
  }

  async pauseRuntimeDispatch(workspaceId: string) {
    const response = await this.request<{ snapshot: RuntimeWorkspaceSnapshot }>(
      `/api/workspaces/runtime/${encodeURIComponent(workspaceId)}/dispatch/pause`,
      {
        method: "POST",
      },
    )
    return response.snapshot
  }

  async updateRuntimeModelPool(workspaceId: string, request: RuntimeModelPoolUpdateRequest) {
    const response = await this.request<{ snapshot: RuntimeWorkspaceSnapshot }>(
      `/api/workspaces/runtime/${encodeURIComponent(workspaceId)}/model-pool`,
      {
        method: "POST",
        body: JSON.stringify(request),
      },
    )
    return response.snapshot
  }

  async syncRuntimeChallenges(workspaceId: string) {
    const response = await this.request<{ snapshot: RuntimeWorkspaceSnapshot }>(
      `/api/workspaces/runtime/${encodeURIComponent(workspaceId)}/sync/challenges`,
      {
        method: "POST",
      },
    )
    return response.snapshot
  }

  async syncRuntimeNotices(workspaceId: string) {
    const response = await this.request<{ snapshot: RuntimeWorkspaceSnapshot }>(
      `/api/workspaces/runtime/${encodeURIComponent(workspaceId)}/sync/notices`,
      {
        method: "POST",
      },
    )
    return response.snapshot
  }

  async enqueueRuntimeChallenge(workspaceId: string, request: RuntimeEnqueueRequest) {
    const response = await this.request<{ snapshot: RuntimeWorkspaceSnapshot }>(
      `/api/workspaces/runtime/${encodeURIComponent(workspaceId)}/queue/enqueue`,
      {
        method: "POST",
        body: JSON.stringify(request),
      },
    )
    return response.snapshot
  }

  async ensureRuntimeEnvironmentAgent(workspaceId: string) {
    const response = await this.request<{ snapshot: RuntimeWorkspaceSnapshot }>(
      `/api/workspaces/runtime/${encodeURIComponent(workspaceId)}/agents/environment`,
      {
        method: "POST",
      },
    )
    return response.snapshot
  }

  async getRuntimeAgentState(workspaceId: string, agentId: string) {
    const response = await this.request<{ state: AgentStateSnapshot }>(
      `/api/workspaces/runtime/${encodeURIComponent(workspaceId)}/agents/${encodeURIComponent(agentId)}/state`,
    )
    return response.state
  }

  async promptRuntimeAgent(
    workspaceId: string,
    agentId: string,
    prompt: string,
    mode: PromptMode = "followup",
  ) {
    const response = await this.request<{ state: AgentStateSnapshot }>(
      `/api/workspaces/runtime/${encodeURIComponent(workspaceId)}/agents/${encodeURIComponent(agentId)}/prompt`,
      {
        method: "POST",
        body: JSON.stringify({ prompt, mode }),
      },
    )
    return response.state
  }

  async createSolverWorkspace(request: SolverCreateRequest) {
    const response = await this.request<{ snapshot: SolverWorkspaceSnapshot }>(
      "/api/workspaces/solver",
      {
        method: "POST",
        body: JSON.stringify(request),
      },
    )
    return response.snapshot
  }

  async getSolverWorkspace(workspaceId: string) {
    const response = await this.request<{ snapshot: SolverWorkspaceSnapshot }>(
      `/api/workspaces/solver/${encodeURIComponent(workspaceId)}`,
    )
    return response.snapshot
  }

  async getSolverAgentState(workspaceId: string) {
    const response = await this.request<{ state: AgentStateSnapshot }>(
      `/api/workspaces/solver/${encodeURIComponent(workspaceId)}/agent/state`,
    )
    return response.state
  }

  async promptSolver(workspaceId: string, prompt: string, mode: PromptMode = "followup") {
    const response = await this.request<{ state: AgentStateSnapshot }>(
      `/api/workspaces/solver/${encodeURIComponent(workspaceId)}/prompt`,
      {
        method: "POST",
        body: JSON.stringify({ prompt, mode }),
      },
    )
    return response.state
  }

  private async request<T>(path: string, init?: RequestInit) {
    const headers = new Headers(init?.headers)
    headers.set("content-type", "application/json")

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    })

    const payload = (await response.json()) as { error?: string } & T
    if (!response.ok) {
      throw new Error(payload.error ?? `Request failed with status ${String(response.status)}`)
    }

    return payload
  }
}
