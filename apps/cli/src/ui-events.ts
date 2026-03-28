export type RuntimeJsonValue =
  | string
  | number
  | boolean
  | null
  | RuntimeJsonValue[]
  | { [key: string]: RuntimeJsonValue }

export type RuntimeEventSource = "server" | "coordinator" | "solver"

export interface RuntimeEventEnvelope<TPayload extends RuntimeJsonValue = RuntimeJsonValue> {
  seq: number
  ts: string
  source: RuntimeEventSource
  type: string
  payload: TPayload
}

export type EventTab = "coordinator" | "solver"

export interface EventQuery {
  tab: EventTab
  selectedSolverId?: string
  limit?: number
}

const IMPORTANT_EVENT_TYPES = new Set<string>([
  "runtime.started",
  "runtime.resumed",
  "runtime.command.accepted",
  "runtime.command.executed",
  "error",
  "coordinator.message",
  "coordinator.tool.start",
  "coordinator.tool.end",
  "coordinator.stopped",
  "solver.message",
  "solver.tool.start",
  "solver.tool.end",
  "solver.flag.reported",
  "solver.stopped",
])

function isRuntimeJsonObject(
  value: RuntimeJsonValue,
): value is { [key: string]: RuntimeJsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}...`
}

function compactJson(value: RuntimeJsonValue): string {
  return JSON.stringify(value)
}

function payloadString(payload: RuntimeJsonValue, key: string): string | undefined {
  if (!isRuntimeJsonObject(payload)) return undefined
  const value = payload[key]
  return typeof value === "string" ? value : undefined
}

function payloadBoolean(payload: RuntimeJsonValue, key: string): boolean | undefined {
  if (!isRuntimeJsonObject(payload)) return undefined
  const value = payload[key]
  return typeof value === "boolean" ? value : undefined
}

function formatTimestamp(ts: string): string {
  if (ts.length < 19) return ts
  return ts.slice(11, 19)
}

function eventSolverId(event: RuntimeEventEnvelope): string | undefined {
  return payloadString(event.payload, "solverId")
}

function isCoordinatorScopeEvent(event: RuntimeEventEnvelope): boolean {
  if (event.source === "coordinator" || event.source === "server") {
    return true
  }

  return event.type === "solver.flag.reported" || event.type === "solver.stopped"
}

function matchesSolverScope(event: RuntimeEventEnvelope, solverId: string): boolean {
  return eventSolverId(event) === solverId
}

export function isImportantEvent(event: RuntimeEventEnvelope): boolean {
  if (!IMPORTANT_EVENT_TYPES.has(event.type)) {
    return false
  }

  if (event.type === "solver.tool.end") {
    return payloadBoolean(event.payload, "isError") === true
  }

  return true
}

export function filterImportantEvents(
  events: RuntimeEventEnvelope[],
  query: EventQuery,
): RuntimeEventEnvelope[] {
  const limit = query.limit ?? 12
  const important = events.filter((event) => isImportantEvent(event))

  const scoped = important.filter((event) => {
    if (query.tab === "coordinator") {
      return isCoordinatorScopeEvent(event)
    }

    if (!query.selectedSolverId) {
      return false
    }

    return matchesSolverScope(event, query.selectedSolverId)
  })

  return scoped.slice(-Math.max(1, limit))
}

export function formatImportantEvent(event: RuntimeEventEnvelope): string {
  const time = formatTimestamp(event.ts)

  if (event.type === "coordinator.message") {
    const summary = payloadString(event.payload, "summary") ?? "message"
    return `${time} [MSG] ${truncate(summary, 100)}`
  }

  if (event.type === "coordinator.tool.start") {
    const tool = payloadString(event.payload, "toolName") ?? "tool"
    return `${time} [TOOL>] ${tool}`
  }

  if (event.type === "coordinator.tool.end") {
    const tool = payloadString(event.payload, "toolName") ?? "tool"
    const failed = payloadBoolean(event.payload, "isError") === true
    return `${time} [TOOL<] ${tool}${failed ? " (failed)" : ""}`
  }

  if (event.type === "runtime.command.accepted" || event.type === "runtime.command.executed") {
    const command = payloadString(event.payload, "command") ?? "command"
    const solverId = payloadString(event.payload, "solverId")
    const suffix = solverId ? ` (${solverId})` : ""
    const label = event.type.endsWith("accepted") ? "[CMD>]" : "[CMD<]"
    return `${time} ${label} ${command}${suffix}`
  }

  if (event.type === "solver.message") {
    const solverId = payloadString(event.payload, "solverId") ?? "solver"
    const summary = payloadString(event.payload, "summary") ?? "message"
    return `${time} [SOLVER] ${solverId}: ${truncate(summary, 90)}`
  }

  if (event.type === "solver.flag.reported") {
    const solverId = payloadString(event.payload, "solverId") ?? "solver"
    const flag = payloadString(event.payload, "flag") ?? "(unknown)"
    return `${time} [FLAG] ${solverId}: ${truncate(flag, 70)}`
  }

  if (event.type === "solver.stopped") {
    const solverId = payloadString(event.payload, "solverId") ?? "solver"
    return `${time} [STOP] ${solverId}`
  }

  if (event.type === "error") {
    const message = payloadString(event.payload, "message") ?? compactJson(event.payload)
    return `${time} [ERR] ${truncate(message, 100)}`
  }

  return `${time} [${event.type}] ${truncate(compactJson(event.payload), 80)}`
}
