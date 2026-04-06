import type { App, InjectionKey } from "vue"
import { inject } from "vue"
import { RealtimeClient } from "../services/realtime-client.ts"
import { WorkspaceApiClient } from "../services/workspace-api.ts"

export interface AppServices {
  apiClient: WorkspaceApiClient
  realtimeClient: RealtimeClient
}

export const appServicesKey: InjectionKey<AppServices> = Symbol("misuzu-web-app-services")

export function createAppServices(): AppServices {
  return {
    apiClient: new WorkspaceApiClient(""),
    realtimeClient: new RealtimeClient(),
  }
}

export function provideAppServices(app: App, services = createAppServices()) {
  app.provide(appServicesKey, services)
  return services
}

export function useAppServices() {
  const services = inject(appServicesKey)
  if (!services) {
    throw new Error("AppServices not provided. Ensure provideAppServices(app) is called in main.ts")
  }

  return services
}
