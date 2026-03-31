export {
  FeaturedAgent,
  type FeaturedAgentDependencies,
  type FeaturedAgentOptions,
} from "./agents/featured.js"
export {
  ProviderRegistry,
  type ProxyProviderModelMapping,
  type ProxyProviderOptions,
} from "./providers/index.js"
export {
  createWorkspace,
  getWorkspace,
  Workspace,
  type WorkspaceOptions,
} from "./workspace/index.js"
export { SessionContext } from "./session/context.js"
export { type PersistenceStore } from "./persistence/store.js"
export { NoopPersistenceStore } from "./persistence/noop-store.js"
export { Container, createContainer, createToken, type Token } from "./di/container.js"
export { persistenceStoreToken, providerRegistryToken, sessionContextToken } from "./di/tokens.js"
