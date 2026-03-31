export type LogLevel = "debug" | "info" | "warn" | "error"

export type LogContext = Record<string, unknown>

export interface LogError {
  name?: string
  message: string
  stack?: string
}

export interface LogRecord {
  timestamp: number
  level: LogLevel
  message: string
  context: LogContext
  data?: unknown
  error?: LogError
}

export interface LogSink {
  write(record: LogRecord): Promise<void> | void
}

export interface Logger {
  child(context: LogContext): Logger
  debug(message: string, data?: unknown): void
  info(message: string, data?: unknown): void
  warn(message: string, data?: unknown, error?: unknown): void
  error(message: string, data?: unknown, error?: unknown): void
}
