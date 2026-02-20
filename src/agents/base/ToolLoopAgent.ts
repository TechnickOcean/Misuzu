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
  instruction
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
    this.instruction = instruction
    this.#model = model
    this.#tools = tools
    this.#onStepEnd = onStepEnd
  }

  #handleToolcalls(toolcalls: ChatCompletionMessageToolCall[]) {
    return new Promise((resolve, reject) => {
      Promise.all(
        toolcalls.map(async (toolcall) => {
          const callInfo = toolcall.type === "function" ? toolcall.function : toolcall.custom
          const callArg = toolcall.type === "function" ? toolcall.function.arguments : toolcall.custom.input
          const targetTool = this.#tools.find((tool) => tool.name === callInfo.name)
          console.log(`Calling ${targetTool?.name}(${callArg})`)
          return {
            content: (await targetTool?.execute(callArg)) ?? "There's no output.",
            role: "tool",
            tool_call_id: toolcall.id
          } satisfies ChatCompletionMessageParam
        })
      )
        .then((results) => {
          this.context = this.context.concat(results)
          resolve(results)
        })
        .catch(reject)
    })
  }

  async compact() {
    // adaption to https://github.com/anomalyco/opencode/blob/eb553f53ac9689ab2056fceea0c7b0504f642101/packages/opencode/src/agent/prompt/compaction.txt
    const prompt = `You are an expert AI assistant specialized in summarizing technical conversations.

    Your goal is to create a concise yet comprehensive summary that serves as a context restoration point for future interactions.
    
    Key elements to include:
    - **Completed Actions:** Briefly list what has been accomplished.
    - **Current Status:** Describe the ongoing task and its state.
    - **File Context:** List modified or relevant files.
    - **Next Steps:** Clearly outline the immediate next actions required.
    - **Constraints & Decisions:** Note any user preferences, constraints, or key technical decisions made.
    
    Output *only* the summary. Do not answer questions or add conversational filler.`
    this.context.push({ role: "user", content: "Summarize" })
    const nr = await requestAPI(this.#model, prompt, this.context)
    if (!nr.choices) return
    this.context = [{ role: "user", content: nr.choices[0]?.message.content ?? "" }]
  }

  async step() {
    let nextStepFlag = true
    const r = await requestAPI(
      this.#model,
      this.instruction,
      this.context,
      this.#tools.map((t) => t.make_schema())
    )
    for (const choice of r.choices) {
      switch (choice.finish_reason) {
        case "tool_calls":
          if (choice.message.tool_calls) await this.#handleToolcalls(choice.message.tool_calls)
          // @ts-expect-error addtional prop added by qwen api
          console.log(choice.message.reasoning_content)
          break
        case "stop":
          nextStepFlag = false
          this.context.push({ role: "assistant", content: choice.message.content })
          console.log(choice.message.content)
          break
        case "content_filter":
          nextStepFlag = false
          // this.context.splice(
          //   this.context.findLastIndex((i) => i.role === "user"),
          //   1
          // )
          console.log("filtered")
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
