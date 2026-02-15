import type { ChatCompletionMessageParam, ChatCompletionMessageToolCall } from "openai/resources"
import type * as z from "zod"
import type BaseCustomTool from "@/tools/base/CustomTool"
import type BaseFunctionTool from "@/tools/base/FunctionTool"
import requestAPI, { type ModelWithTools } from "@/utils/api"

type Tool = BaseCustomTool<unknown> | BaseFunctionTool<z.ZodType, unknown>

interface stepEndCallbackResp {
  APIResponse: Awaited<ReturnType<typeof requestAPI>>
  stop: () => void
}

class ToolLoopAgent {
  #model
  #tools
  #onStepEnd
  reasoning_flow: string[] = []
  context: ChatCompletionMessageParam[] = []
  constructor({
    model,
    instruction,
    tools,
    onStepEnd
  }: {
    model: ModelWithTools
    instruction: string
    tools: Tool[]
    onStepEnd?: (callInfo: stepEndCallbackResp) => void
  }) {
    this.#model = model
    this.#tools = tools
    this.context.push({ role: "system", content: instruction })
    this.#onStepEnd = onStepEnd
  }
  #handleToolcalls(toolcalls: ChatCompletionMessageToolCall[]) {
    return new Promise((resolve, reject) => {
      Promise.all(
        toolcalls.map(async (toolcall) => {
          const callInfo = toolcall.type === "function" ? toolcall.function : toolcall.custom
          const targetTool = this.#tools.find((tool) => tool.name === callInfo.name)
          return {
            content:
              (await targetTool?.execute(
                toolcall.type === "function" ? toolcall.function.arguments : toolcall.custom.input
              )) ?? "There's no output.",
            role: "tool",
            tool_call_id: toolcall.id
          } satisfies ChatCompletionMessageParam
        })
      )
        .then((results) => {
          this.context.concat(results)
          resolve(results)
        })
        .catch((e) => {
          reject(e)
        })
    })
  }
  async compact() {
    // TODO
    return
  }
  async step() {
    let nextStepFlag = true
    const r = await requestAPI(
      this.#model,
      this.context,
      this.#tools.map((t) => t.make_schema())
    )
    for (const choice of r.choices) {
      switch (choice.finish_reason) {
        case "tool_calls":
          if (choice.message.tool_calls) await this.#handleToolcalls(choice.message.tool_calls)
          // @ts-expect-error addtional prop added by qwen api
          this.reasoning_flow.push(choice.message.reasoning_content)
          break
        case "stop":
          nextStepFlag = false
          this.context.push({ role: "assistant", content: choice.message.content })
          console.log(choice.message.content)
          break
        case "content_filter":
          nextStepFlag = false
          console.log("filtered")
          // pop last user input here
          break
        case "length":
          console.log(choice.message.content)
          await this.compact()
          break
      }
    }
    if (this.#onStepEnd)
      this.#onStepEnd({
        APIResponse: r,
        stop: (() => {
          nextStepFlag = false
        }).bind(this)
      })
    if (nextStepFlag) await this.step()
  }
  async generate({ prompt }: { prompt: string }) {
    this.context.push({ role: "user", content: prompt })
    await this.step()
  }
}

export default ToolLoopAgent
