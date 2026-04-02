export {
  FeaturedAgent,
  type FeaturedAgentDependencies,
  type FeaturedAgentOptions,
} from "./agents/featured.ts"
export {
  ProviderRegistry,
  type ProxyProviderModelMapping,
  type ProxyProviderOptions,
} from "./core/application/providers/index.ts"
export {
  createWorkspaceWithoutPersistence as createWorkspace,
  createWorkspace as createWorkspaceWithPersistence,
  getWorkspace,
  Workspace,
  type WorkspaceOptions,
} from "./core/application/workspace/index.ts"
export {
  type PersistenceStore,
  type PersistedWorkspaceState,
  type PersistedFeaturedAgentState,
  type WorkspaceChange,
} from "./core/application/persistence/store.ts"
export { JsonFilePersistenceAdapter } from "./core/application/persistence/json-adapter.ts"
export {
  ConsoleLogSink,
  type ConsoleLogFormat,
} from "./core/infrastructure/logging/sinks/console-sink.ts"
export {
  createWorkspaceLogger,
  getLogLevelFromEnv,
  WorkspaceLogger,
} from "./core/infrastructure/logging/logger.ts"
export {
  type Logger,
  type LogLevel,
  type LogRecord,
  type LogSink,
} from "./core/infrastructure/logging/types.ts"
export {
  Container,
  createContainer,
  createToken,
  type Token,
} from "./core/infrastructure/di/container.ts"
export {
  loggerToken,
  persistenceStoreToken,
  providerRegistryToken,
} from "./core/infrastructure/di/tokens.ts"
