import type { LogRecord, LogSink } from "../types.ts"

export type ConsoleLogFormat = "pretty" | "json"

function stringifyValue(value: unknown) {
  try {
    return JSON.stringify(value)
  } catch {
    return "[UNSERIALIZABLE]"
  }
}

function writeLine(level: LogRecord["level"], line: string) {
  if (level === "error") {
    console.error(line)
    return
  }

  if (level === "warn") {
    console.warn(line)
    return
  }

  console.log(line)
}

export class ConsoleLogSink implements LogSink {
  constructor(private readonly format: ConsoleLogFormat = "pretty") {}

  write(record: LogRecord) {
    if (this.format === "json") {
      writeLine(record.level, stringifyValue(record))
      return
    }

    const base = `[${new Date(record.timestamp).toISOString()}] [${record.level}] ${record.message}`
    const context =
      Object.keys(record.context).length > 0 ? ` ${stringifyValue(record.context)}` : ""
    const data = record.data !== undefined ? ` data=${stringifyValue(record.data)}` : ""
    const error = record.error ? ` error=${stringifyValue(record.error)}` : ""
    writeLine(record.level, `${base}${context}${data}${error}`)
  }
}
