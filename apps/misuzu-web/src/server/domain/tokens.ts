import { createToken } from "../di/container.ts"
import { EventBus } from "../services/event-bus.ts"
import { WorkspaceManager } from "../services/workspace-manager.ts"
import { WorkspaceRegistryStore } from "../services/workspace-registry-store.ts"

export const workspaceRegistryStoreToken = createToken<WorkspaceRegistryStore>(
  "workspace-registry-store",
)
export const eventBusToken = createToken<EventBus>("event-bus")
export const workspaceManagerToken = createToken<WorkspaceManager>("workspace-manager")
