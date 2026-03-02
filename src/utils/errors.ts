export type ErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "UPSTREAM_ERROR"
  | "CONFLICT"
  | "TOOL_ERROR"
  | "UNKNOWN_ERROR"

export interface ErrorResponse {
  success: false
  error: {
    code: ErrorCode
    message: string
    context?: Record<string, unknown>
  }
}

export class AppError extends Error {
  code: ErrorCode
  context?: Record<string, unknown>

  constructor(code: ErrorCode, message: string, context?: Record<string, unknown>) {
    super(message)
    this.name = "AppError"
    this.code = code
    this.context = context
  }
}

export function toErrorResponse(error: unknown, fallback: { code: ErrorCode; message: string }): ErrorResponse {
  if (error instanceof AppError) {
    return {
      success: false,
      error: {
        code: error.code,
        message: error.message,
        context: error.context
      }
    }
  }

  if (error instanceof Error) {
    return {
      success: false,
      error: {
        code: fallback.code,
        message: error.message
      }
    }
  }

  return {
    success: false,
    error: {
      code: fallback.code,
      message: fallback.message
    }
  }
}
