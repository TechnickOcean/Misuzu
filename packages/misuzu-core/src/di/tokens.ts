import { createToken } from "./container.ts"
import type { Logger } from "../logging/types.ts"
import type { ProviderRegistry } from "../providers/index.ts"
import type { SessionContext } from "../session/context.ts"
import type { PersistenceStore } from "../persistence/store.ts"

export const loggerToken = createToken<Logger>("logger")
export const providerRegistryToken = createToken<ProviderRegistry>("providerRegistry")
export const sessionContextToken = createToken<SessionContext>("sessionContext")
export const persistenceStoreToken = createToken<PersistenceStore>("persistenceStore")
