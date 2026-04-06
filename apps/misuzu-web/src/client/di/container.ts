import { RealtimeClient } from "../services/realtime-client.ts"
import { WorkspaceApiClient } from "../services/workspace-api.ts"

export class ClientContainer {
  private apiClient?: WorkspaceApiClient
  private realtimeClient?: RealtimeClient

  getApiClient() {
    if (!this.apiClient) {
      this.apiClient = new WorkspaceApiClient("")
    }

    return this.apiClient
  }

  getRealtimeClient() {
    if (!this.realtimeClient) {
      this.realtimeClient = new RealtimeClient()
    }

    return this.realtimeClient
  }
}

const clientContainer = new ClientContainer()

export function useClientContainer() {
  return clientContainer
}
