import type { ChatCompletionTool } from "openai/resources"

class BaseCustomTool<T> {
  #name: string
  #description: string
  #function: (para: string) => T
  // tool function, accept an object
  constructor({ name, description, func }: { name: string; description: string; func: (para: string) => T }) {
    this.#name = name
    this.#description = description
    this.#function = func
  }
  execute(input: string) {
    try {
      this.#function(input)
    } catch (e) {
      if (e instanceof Error) return `Execution failed due to ${e.name}\n${e.message}\n${e?.stack}`
      return "Execution failed due to unknown error."
    }
  }
  make_schema(): ChatCompletionTool {
    return {
      type: "custom",
      custom: {
        name: this.#name,
        description: this.#description
      }
    }
  }
}

export default BaseCustomTool
