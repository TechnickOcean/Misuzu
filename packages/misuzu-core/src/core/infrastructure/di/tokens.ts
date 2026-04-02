import { createToken } from "./container.ts"
import type { Logger } from "../logging/types.ts"
import type { ProviderRegistry } from "../../application/providers/index.ts"
import type { PersistenceStore } from "../../application/persistence/store.ts"

export const loggerToken = createToken<Logger>("logger")
export const providerRegistryToken = createToken<ProviderRegistry>("providerRegistry")
export const persistenceStoreToken = createToken<PersistenceStore>("persistenceStore")
