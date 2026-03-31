import { createToken } from "./container.ts"
import type { ProviderRegistry } from "../providers/index.ts"
import type { SessionContext } from "../session/context.ts"
import type { PersistenceStore } from "../persistence/store.ts"

export const providerRegistryToken = createToken<ProviderRegistry>("providerRegistry")
export const sessionContextToken = createToken<SessionContext>("sessionContext")
export const persistenceStoreToken = createToken<PersistenceStore>("persistenceStore")
