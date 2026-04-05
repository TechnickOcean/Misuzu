import { redact } from "./redactor.ts"
import type { LogContext, LogError, LogLevel, LogRecord, Logger, LogSink } from "./types.ts"

const LOG_LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

const DEFAULT_LOG_SOURCE = "misuzu"

function normalizeLogLevel(level: string | undefined): LogLevel {
  const normalized = level?.toLowerCase()

  if (
    normalized === "debug" ||
    normalized === "info" ||
    normalized === "warn" ||
    normalized === "error"
  ) {
    return normalized
  }

  return "info"
}

function normalizeError(error: unknown): LogError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    }
  }

  return {
    message: String(error),
  }
}

function normalizeSource(source: string) {
  return source.trim().replace(/[[\]]/g, "")
}

function resolveLogSource(context: LogContext) {
  const candidate = context.component
  if (typeof candidate === "string" && candidate.trim().length > 0) {
    return normalizeSource(candidate)
  }

  return DEFAULT_LOG_SOURCE
}

function formatLogMessage(message: string, context: LogContext) {
  const source = resolveLogSource(context)
  return `[${source}] ${message}`
}

export interface LoggerOptions {
  level?: LogLevel
  context?: LogContext
  sinks: LogSink[]
}

export class WorkspaceLogger implements Logger {
  private readonly level: LogLevel
  private readonly context: LogContext

  constructor(
    private readonly sinks: LogSink[],
    options: Omit<LoggerOptions, "sinks"> = {},
  ) {
    this.level = options.level ?? "info"
    this.context = options.context ?? {}
  }

  child(context: LogContext): Logger {
    return new WorkspaceLogger(this.sinks, {
      level: this.level,
      context: { ...this.context, ...context },
    })
  }

  debug(message: string, data?: unknown) {
    this.log("debug", message, data)
  }

  info(message: string, data?: unknown) {
    this.log("info", message, data)
  }

  warn(message: string, data?: unknown, error?: unknown) {
    this.log("warn", message, data, error)
  }

  error(message: string, data?: unknown, error?: unknown) {
    this.log("error", message, data, error)
  }

  private shouldWrite(level: LogLevel) {
    return LOG_LEVEL_WEIGHT[level] >= LOG_LEVEL_WEIGHT[this.level]
  }

  private log(level: LogLevel, message: string, data?: unknown, error?: unknown) {
    if (!this.shouldWrite(level)) {
      return
    }

    const record: LogRecord = {
      timestamp: Date.now(),
      level,
      message: formatLogMessage(message, this.context),
      context: this.context,
    }

    if (data !== undefined) {
      record.data = redact(data)
    }

    if (error !== undefined) {
      record.error = normalizeError(error)
    }

    for (const sink of this.sinks) {
      try {
        void Promise.resolve(sink.write(record)).catch(() => {})
      } catch {}
    }
  }
}

export function createWorkspaceLogger(options: LoggerOptions): Logger {
  return new WorkspaceLogger(options.sinks, {
    level: options.level,
    context: options.context,
  })
}

export function getLogLevelFromEnv(env = process.env) {
  return normalizeLogLevel(env.MISUZU_LOG_LEVEL)
}
