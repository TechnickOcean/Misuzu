import type { ModelPoolInput } from "@shared/protocol.ts"

export interface ModelPoolRow {
  id: string
  provider: string
  modelId: string
  maxConcurrency: string
}

export function createModelPoolRow(input?: Partial<ModelPoolInput>): ModelPoolRow {
  return {
    id: crypto.randomUUID(),
    provider: input?.provider ?? "",
    modelId: input?.modelId ?? "",
    maxConcurrency: String(input?.maxConcurrency ?? 1),
  }
}

export function normalizeModelPoolRows(rows: ModelPoolRow[]): ModelPoolInput[] {
  return rows.map((item) => {
    const provider = item.provider.trim()
    const modelId = item.modelId.trim()
    const maxConcurrency = Number(item.maxConcurrency)
    if (!provider || !modelId) {
      throw new Error("Model pool provider/model id cannot be empty")
    }

    if (!Number.isInteger(maxConcurrency) || maxConcurrency <= 0) {
      throw new Error("Model pool maxConcurrency must be a positive integer")
    }

    return {
      provider,
      modelId,
      maxConcurrency,
    }
  })
}
