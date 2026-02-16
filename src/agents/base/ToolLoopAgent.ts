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
    this.instruction = instruction
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
          console.log(`Calling ${targetTool?.name} with ${JSON.stringify(callInfo)}`)
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
          this.context = this.context.concat(results)
          resolve(results)
        })
        .catch((e) => {
          reject(e)
        })
    })
  }
  async compact() {
    // https://github.com/anomalyco/opencode/blob/eb553f53ac9689ab2056fceea0c7b0504f642101/packages/opencode/src/agent/prompt/compaction.txt
    const prompt = `You are a helpful AI assistant tasked with summarizing conversations.

    When asked to summarize, provide a detailed but concise summary of the conversation.
    Focus on information that would be helpful for continuing the conversation, including:
    - What was done
    - What is currently being worked on
    - Which files are being modified
    - What needs to be done next
    - Key user requests, constraints, or preferences that should persist
    - Important technical decisions and why they were made
    
    Your summary should be comprehensive enough to provide context but concise enough to be quickly understood.
    
    Do not respond to any questions in the conversation, only output the summary.`
    const nr = await requestAPI(this.#model, [
      {
        role: "system",
        content: prompt
      },
      ...this.context.slice(1)
    ])
    if (!nr.choices) return
    this.context = [
      { role: "system", content: this.instruction },
      { role: "user", content: nr.choices[0]?.message.content ?? "" }
    ]
  }
  async step() {
    let shouldContinue = true
    
    while (shouldContinue) {
      const r = await requestAPI(
        this.#model,
        this.context,
        this.#tools.map((t) => t.make_schema())
      )
      
      let nextStepFlag = true
      for (const choice of r.choices) {
        switch (choice.finish_reason) {
          case "tool_calls":
            if (choice.message.tool_calls) await this.#handleToolcalls(choice.message.tool_calls)
            // @ts-expect-error additional prop added by qwen api
            this.reasoning_flow.push(choice.message.reasoning_content)
            break
          case "stop":
            nextStepFlag = false
            this.context.push({ role: "assistant", content: choice.message.content })
            console.log(choice.message.content)
            break
          case "content_filter":
            nextStepFlag = false
            this.context.splice(
              this.context.findLastIndex((i) => i.role === "user"),
              1
            )
            console.log("filtered")
            break
          case "length":
            console.log(choice.message.content)
            await this.compact()
            break
        }
      }
      
      if (this.#onStepEnd) {
        this.#onStepEnd({
          APIResponse: r,
          stop: (() => {
            nextStepFlag = false
          }).bind(this)
        })
      }
      
      shouldContinue = nextStepFlag
    }
  }
  async generate({ prompt }: { prompt: string }) {
    this.context.push({ role: "user", content: prompt })
    await this.step()
  }
}

export default ToolLoopAgent
