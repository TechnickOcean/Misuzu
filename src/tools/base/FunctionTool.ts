import type { ChatCompletionTool } from "openai/resources"
import * as z from "zod"
import { AppError, toErrorResponse } from "@/utils/errors"
import logger from "@/utils/logger"

class BaseFunctionTool<T extends z.ZodType, K> {
  name: string
  #description: string
  #schema: T
  #function: (para: z.infer<T>) => K
  // tool function, accept an object
  constructor({
    name,
    description,
    schema,
    func
  }: { name: string; description: string; schema: T; func: (para: z.infer<T>) => K }) {
    this.name = name
    this.#schema = schema
    this.#description = description
    this.#function = func
  }
  async execute(json: string) {
    try {
      const parameters = await this.#schema.parseAsync(JSON.parse(json))
      const result = this.#function(parameters)
      if (result instanceof Promise) {
        return JSON.stringify(await result)
      } else {
        return JSON.stringify(result)
      }
    } catch (e) {
      const error =
        e instanceof z.ZodError
          ? new AppError("VALIDATION_ERROR", "Invalid tool parameters", {
              issues: e.issues
            })
          : e
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
      type: "function",
      function: {
        name: this.name,
        description: this.#description,
        //? https://developers.openai.com/api/docs/guides/function-calling?strict-mode=enabled#strict-mode
        strict: true,
        parameters: this.#schema.toJSONSchema()
      }
    }
  }
}

export default BaseFunctionTool
