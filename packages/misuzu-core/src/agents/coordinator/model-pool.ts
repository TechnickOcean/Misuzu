export interface ModelSlot {
  model: string
  status: "idle" | "busy"
  solverId?: string
}

export interface ModelPoolOptions {
  maxConcurrencyPerModel?: number
}

export function parseModelSlots(value: unknown): ModelSlot[] {
  if (!Array.isArray(value)) return []

  const slots: ModelSlot[] = []
  for (const item of value) {
    if (!item || typeof item !== "object") continue
    const candidate = item as Record<string, unknown>
    if (typeof candidate.model !== "string") continue
    if (candidate.status !== "idle" && candidate.status !== "busy") continue

    slots.push({
      model: candidate.model,
      status: candidate.status,
      solverId: typeof candidate.solverId === "string" ? candidate.solverId : undefined,
    })
  }

  return slots
}

export class ModelPool {
  private slots: ModelSlot[]

  constructor(models: string[], options: ModelPoolOptions = {}) {
    const perModel = Math.max(1, Math.floor(options.maxConcurrencyPerModel ?? 1))
    this.slots = models.flatMap((model) =>
      Array.from({ length: perModel }, () => ({ model, status: "idle" as const })),
    )
  }

  static fromSlots(slots: ModelSlot[]): ModelPool {
    const pool = new ModelPool([])
    pool.slots = slots.map((slot) => ({ ...slot }))
    return pool
  }

  acquire(solverId: string): string | null {
    const slot = this.slots.find((s) => s.status === "idle")
    if (!slot) return null
    slot.status = "busy"
    slot.solverId = solverId
    return slot.model
  }

  release(solverId: string): void {
    const slot = this.slots.find((s) => s.solverId === solverId)
    if (slot) {
      slot.status = "idle"
      slot.solverId = undefined
    }
  }

  get available(): number {
    return this.slots.filter((s) => s.status === "idle").length
  }

  get total(): number {
    return this.slots.length
  }

  countForModel(modelId: string): number {
    return this.slots.filter((slot) => slot.model === modelId).length
  }

  addModel(modelId: string, concurrency = 1): { model: string; added: number; total: number } {
    const normalizedConcurrency = normalizeConcurrency(concurrency)
    this.slots.push(
      ...Array.from({ length: normalizedConcurrency }, () => ({
        model: modelId,
        status: "idle" as const,
      })),
    )

    return {
      model: modelId,
      added: normalizedConcurrency,
      total: this.countForModel(modelId),
    }
  }

  setModelConcurrency(
    modelId: string,
    concurrency: number,
  ): {
    model: string
    previousTotal: number
    total: number
    busy: number
    idle: number
    added: number
    removed: number
  } {
    const target = normalizeConcurrency(concurrency)
    const modelSlots = this.slots.filter((slot) => slot.model === modelId)
    const previousTotal = modelSlots.length
    const busy = modelSlots.filter((slot) => slot.status === "busy").length

    if (target < busy) {
      throw new Error(
        `Cannot set concurrency for ${modelId} to ${target}. ${busy} slot(s) are currently busy.`,
      )
    }

    let added = 0
    let removed = 0

    if (target > previousTotal) {
      added = target - previousTotal
      this.addModel(modelId, added)
    } else if (target < previousTotal) {
      const toRemove = previousTotal - target
      removed = this.removeIdleSlots(modelId, toRemove)
      if (removed !== toRemove) {
        throw new Error(
          `Unable to remove ${toRemove} idle slot(s) for ${modelId}. Only ${removed} slot(s) could be removed.`,
        )
      }
    }

    const total = this.countForModel(modelId)
    const idle = this.slots.filter(
      (slot) => slot.model === modelId && slot.status === "idle",
    ).length
    const busyNow = total - idle

    return {
      model: modelId,
      previousTotal,
      total,
      busy: busyNow,
      idle,
      added,
      removed,
    }
  }

  toJSON(): ModelSlot[] {
    return [...this.slots]
  }

  private removeIdleSlots(modelId: string, count: number): number {
    let removed = 0
    for (let index = this.slots.length - 1; index >= 0 && removed < count; index--) {
      const slot = this.slots[index]
      if (slot.model !== modelId || slot.status !== "idle") continue
      this.slots.splice(index, 1)
      removed += 1
    }
    return removed
  }
}

function normalizeConcurrency(value: number): number {
  const normalized = Math.floor(value)
  if (!Number.isFinite(normalized) || normalized < 1) {
    throw new Error(`Concurrency must be a positive integer. Received: ${value}`)
  }
  return normalized
}
