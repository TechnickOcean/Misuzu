import type { ChatCompletionTool } from "openai/resources"
import type * as z from "zod"

class BaseFuntionTool<T extends z.ZodType, K> {
  #name: string
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
    this.#name = name
    this.#schema = schema
    this.#description = description
    this.#function = func
  }
  async execute(json: string) {
    try {
      const parameters = await this.#schema.parseAsync(JSON.parse(json))
      const result = this.#function(parameters)
      if (result instanceof Promise) {
        return { success: true, result: await result }
      } else {
        return { success: true, result }
      }
    } catch (e) {
      if (e instanceof Error)
        return { success: false, result: `Execution failed due to ${e.name}\n${e.message}\n${e?.stack}` }
      return { success: false, result: "Execution failed due to unknown error." }
    }
  }
  make_schema(): ChatCompletionTool {
    return {
      type: "function",
      function: {
        name: this.#name,
        description: this.#description,
        //? https://developers.openai.com/api/docs/guides/function-calling?strict-mode=enabled#strict-mode
        strict: true,
        parameters: this.#schema.toJSONSchema()
      }
    }
  }
}

export default BaseFuntionTool
