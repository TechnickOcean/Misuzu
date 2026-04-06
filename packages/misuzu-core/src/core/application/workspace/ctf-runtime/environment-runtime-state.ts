import type { AgentMessage, AgentState } from "@mariozechner/pi-agent-core"
import type { EnvironmentAgent } from "../../../../agents/environment.ts"
import type { ProviderRegistry } from "../../providers/registry.ts"
import type { Logger } from "../../../infrastructure/logging/types.ts"
import type { PersistedCTFRuntimeState, PersistedEnvironmentAgentRuntimeState } from "./state.ts"

export const ENVIRONMENT_AGENT_RUNTIME_ID = "environment-agent"

export interface ConsumeEnvironmentRuntimeStateResult {
  restoredState?: PersistedEnvironmentAgentRuntimeState
  remainingRuntimeState?: PersistedCTFRuntimeState
}

export interface BuildEnvironmentInitialStateContextOptions {
  initialState: Partial<AgentState> | undefined
  restoredState: PersistedEnvironmentAgentRuntimeState | undefined
  providers: ProviderRegistry
  logger: Logger
}

export interface EnvironmentInitialStateContext {
  initialState: Partial<AgentState>
  baseSystemPrompt?: string
}

export function consumePendingEnvironmentRuntimeState(
  pendingRuntimeState: PersistedCTFRuntimeState | undefined,
  logger: Logger,
): ConsumeEnvironmentRuntimeStateResult {
  if (!pendingRuntimeState || pendingRuntimeState.runtimeId !== ENVIRONMENT_AGENT_RUNTIME_ID) {
    return {
      remainingRuntimeState: pendingRuntimeState,
    }
  }

  return {
    restoredState: normalizePersistedEnvironmentRuntimeStatePayload(
      pendingRuntimeState.payload,
      logger,
    ),
  }
}

export function normalizePersistedEnvironmentRuntimeStatePayload(
  payload: Record<string, unknown>,
  logger: Logger,
): PersistedEnvironmentAgentRuntimeState | undefined {
  const messages = payload.messages
  if (!Array.isArray(messages)) {
    logger.warn("Invalid environment agent runtime payload: messages must be an array")
    return undefined
  }

  const normalizedState: PersistedEnvironmentAgentRuntimeState = {
    messages: messages as AgentMessage[],
  }

  const modelId = toOptionalString(payload.modelId)
  if (modelId !== undefined) {
    normalizedState.modelId = modelId
  }

  const baseSystemPrompt = toOptionalString(payload.baseSystemPrompt)
  if (baseSystemPrompt !== undefined) {
    normalizedState.baseSystemPrompt = baseSystemPrompt
  }

  const thinkingLevel = toOptionalString(payload.thinkingLevel)
  if (thinkingLevel !== undefined) {
    normalizedState.thinkingLevel = thinkingLevel as AgentState["thinkingLevel"]
  }

  return normalizedState
}

export function buildEnvironmentInitialStateContext(
  options: BuildEnvironmentInitialStateContextOptions,
): EnvironmentInitialStateContext {
  const baseSystemPrompt =
    options.restoredState?.baseSystemPrompt ?? options.initialState?.systemPrompt
  const restoredModel = resolvePersistedEnvironmentModel(
    options.restoredState?.modelId,
    options.providers,
    options.logger,
  )

  const initialState: Partial<AgentState> = {
    ...options.initialState,
    ...(baseSystemPrompt !== undefined ? { systemPrompt: baseSystemPrompt } : {}),
    ...(options.restoredState?.thinkingLevel !== undefined
      ? { thinkingLevel: options.restoredState.thinkingLevel }
      : {}),
    ...(restoredModel ? { model: restoredModel } : {}),
  }

  return {
    initialState,
    baseSystemPrompt,
  }
}

export function createPersistedEnvironmentRuntimeState(
  environmentAgent: EnvironmentAgent,
  baseSystemPrompt: string | undefined,
): PersistedEnvironmentAgentRuntimeState {
  const model = environmentAgent.state.model
  return {
    modelId: model ? `${model.provider}/${model.id}` : undefined,
    baseSystemPrompt,
    thinkingLevel: environmentAgent.state.thinkingLevel,
    messages: [...(environmentAgent.state.messages ?? [])],
  }
}

function resolvePersistedEnvironmentModel(
  modelId: string | undefined,
  providers: ProviderRegistry,
  logger: Logger,
) {
  if (!modelId) {
    return undefined
  }

  const separatorIndex = modelId.indexOf("/")
  if (separatorIndex <= 0 || separatorIndex === modelId.length - 1) {
    logger.warn("Invalid persisted environment model id format", { modelId })
    return undefined
  }

  const provider = modelId.slice(0, separatorIndex)
  const id = modelId.slice(separatorIndex + 1)
  const model = providers.getModel(provider, id)
  if (!model) {
    logger.warn("Persisted environment model not found in provider registry", { modelId })
    return undefined
  }

  return model
}

function toOptionalString(value: unknown) {
  return typeof value === "string" ? value : undefined
}
