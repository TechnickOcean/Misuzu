export interface WorkspaceParams {
  workspaceId: string
}

export interface RuntimeAgentStateParams {
  workspaceId: string
  agentId: string
}

export interface PluginCatalogParams {
  query: string
}

export interface PluginReadmeParams {
  pluginId: string
}

export function normalizeWorkspaceId(workspaceId: string) {
  return workspaceId.trim()
}

export function normalizeAgentId(agentId: string) {
  return agentId.trim()
}

export function normalizePluginId(pluginId: string) {
  return pluginId.trim()
}

export function normalizePluginQuery(query: string) {
  return query.trim()
}
