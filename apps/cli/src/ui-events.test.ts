import { describe, expect, test } from "vite-plus/test"
import {
  filterImportantEvents,
  formatImportantEvent,
  isImportantEvent,
  type RuntimeEventEnvelope,
} from "./ui-events.js"

function event(partial: Partial<RuntimeEventEnvelope> & Pick<RuntimeEventEnvelope, "type">) {
  return {
    seq: partial.seq ?? 1,
    ts: partial.ts ?? "2026-03-28T15:00:00.000Z",
    source: partial.source ?? "solver",
    type: partial.type,
    payload: partial.payload ?? {},
  } as RuntimeEventEnvelope
}

describe("ui event filtering", () => {
  test("ignores non-important noisy events", () => {
    const noisy = event({
      type: "solver.text.delta",
      payload: { solverId: "web-1", deltaLength: 5 },
    })
    expect(isImportantEvent(noisy)).toBe(false)
  })

  test("shows coordinator-scope events in coordinator tab", () => {
    const events: RuntimeEventEnvelope[] = [
      event({
        seq: 1,
        source: "coordinator",
        type: "coordinator.message",
        payload: { summary: "coordinator update" },
      }),
      event({
        seq: 2,
        source: "solver",
        type: "solver.message",
        payload: { solverId: "web-1", summary: "working" },
      }),
      event({
        seq: 3,
        source: "solver",
        type: "solver.flag.reported",
        payload: { solverId: "web-1", flag: "CTF{ok}" },
      }),
    ]

    const result = filterImportantEvents(events, { tab: "coordinator" })
    expect(result.map((item) => item.seq)).toEqual([1, 3])
  })

  test("shows only selected solver events in solver tab", () => {
    const events: RuntimeEventEnvelope[] = [
      event({
        seq: 1,
        source: "solver",
        type: "solver.message",
        payload: { solverId: "web-1", summary: "a" },
      }),
      event({
        seq: 2,
        source: "solver",
        type: "solver.message",
        payload: { solverId: "crypto-1", summary: "b" },
      }),
      event({
        seq: 3,
        source: "server",
        type: "runtime.command.executed",
        payload: { command: "solver_abort", solverId: "web-1" },
      }),
    ]

    const result = filterImportantEvents(events, { tab: "solver", selectedSolverId: "web-1" })
    expect(result.map((item) => item.seq)).toEqual([1, 3])
  })
})

describe("ui event formatting", () => {
  test("formats command and error events with dedicated labels", () => {
    const command = event({
      source: "server",
      type: "runtime.command.executed",
      payload: { command: "solver_continue", solverId: "web-1" },
    })
    const error = event({ source: "server", type: "error", payload: { message: "boom" } })

    expect(formatImportantEvent(command)).toContain("[CMD<]")
    expect(formatImportantEvent(command)).toContain("solver_continue")
    expect(formatImportantEvent(error)).toContain("[ERR]")
    expect(formatImportantEvent(error)).toContain("boom")
  })
})
