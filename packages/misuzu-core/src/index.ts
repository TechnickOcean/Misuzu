export {
  FeaturedAgent,
  type FeaturedAgentDependencies,
  type FeaturedAgentOptions,
} from "./agents/featured.js"
export {
  ProviderRegistry,
  type ProxyProviderModelMapping,
  type ProxyProviderOptions,
} from "./core/application/providers/index.ts"
export {
  createWorkspace,
  getWorkspace,
  Workspace,
  type WorkspaceOptions,
} from "./core/application/workspace/index.js"
export { SessionContext } from "./core/application/session/context.js"
export { type PersistenceStore } from "./core/application/persistence/store.js"
export { NoopPersistenceStore } from "./core/infrastructure/persistence/noop-store.js"
export {
  ConsoleLogSink,
  type ConsoleLogFormat,
} from "./core/infrastructure/logging/sinks/console-sink.js"
export {
  createWorkspaceLogger,
  getLogLevelFromEnv,
  WorkspaceLogger,
} from "./core/infrastructure/logging/logger.js"
export {
  type Logger,
  type LogLevel,
  type LogRecord,
  type LogSink,
} from "./core/infrastructure/logging/types.js"
export {
  Container,
  createContainer,
  createToken,
  type Token,
} from "./core/infrastructure/di/container.js"
export {
  loggerToken,
  persistenceStoreToken,
  providerRegistryToken,
  sessionContextToken,
} from "./core/infrastructure/di/tokens.js"
