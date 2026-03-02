import type { ChatCompletionTool } from "openai/resources"
import { AppError, toErrorResponse } from "@/utils/errors"
import logger from "@/utils/logger"

class BaseCustomTool<T> {
  name: string
  #description: string
  #function: (para: string) => T
  // tool function, accept an object
  constructor({ name, description, func }: { name: string; description: string; func: (para: string) => T }) {
    this.name = name
    this.#description = description
    this.#function = func
  }
  async execute(para: string) {
    try {
      const result = this.#function(para)
      if (result instanceof Promise) {
        return JSON.stringify(await result)
      } else {
        return JSON.stringify(result)
      }
    } catch (e) {
      const error = e instanceof Error ? e : new AppError("TOOL_ERROR", "Tool execution failed")
      const response = toErrorResponse(error, {
        code: "TOOL_ERROR",
        message: "Tool execution failed"
      })
      logger.error({ tool: this.name, error: e instanceof Error ? e.message : String(e) }, "tool execution failed")
      return JSON.stringify(response)
    }
  }
  make_schema(): ChatCompletionTool {
    return {
      type: "custom",
      custom: {
        name: this.name,
        description: this.#description
      }
    }
  }
}

export default BaseCustomTool
