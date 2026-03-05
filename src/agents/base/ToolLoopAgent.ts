import type { ChatCompletionMessageParam, ChatCompletionMessageToolCall } from "openai/resources"
import type * as z from "zod"
import type BaseCustomTool from "@/tools/base/CustomTool"
import type BaseFunctionTool from "@/tools/base/FunctionTool"
import requestAPI, { type ModelWithTools } from "@/utils/api"
import logger from "@/utils/logger"

type Tool = BaseCustomTool<unknown> | BaseFunctionTool<z.ZodType, unknown>

type StopReason = "stop" | "content_filter" | "max_steps"

interface stepEndCallbackResp {
  APIResponse?: Awaited<ReturnType<typeof requestAPI>>
  stop: () => void
  stopReason?: StopReason
}

export interface ToolLoopAgentOptions {
  model: ModelWithTools
  instruction: string
  tools: Tool[]
  onStepEnd?: (callInfo: stepEndCallbackResp) => void
  onEvent?: (event: ToolLoopEvent) => void
  maxSteps?: number
  maxRetries?: number
  initialContext?: ChatCompletionMessageParam[]
}

export type ToolLoopEvent =
  | { type: "step_start"; step: number }
  | { type: "step_end"; step: number }
  | { type: "tool_call"; tool: string; input: string }
  | { type: "tool_result"; tool: string; output: string }
  | { type: "model_output"; content: string | null }
  | { type: "retry"; attempt: number; error: unknown }
  | { type: "max_steps"; maxSteps: number }
  | { type: "content_filter" }
  | { type: "length" }

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

class ToolLoopAgent {
  #model
  #tools
  #onStepEnd
  #onEvent
  instruction
  context: ChatCompletionMessageParam[] = []
  maxSteps: number
  maxRetries: number
  stepCount = 0

  constructor({
    model,
    instruction,
    tools,
    onStepEnd,
    onEvent,
    maxSteps = 200,
    maxRetries = 5,
    initialContext
  }: ToolLoopAgentOptions) {
    this.instruction = instruction
    this.#model = model
    this.#tools = tools
    this.#onStepEnd = onStepEnd
    this.#onEvent = onEvent
    this.maxSteps = maxSteps
    this.maxRetries = maxRetries
    if (initialContext?.length) {
      this.context = initialContext
    }
  }

  #handleToolcalls(toolcalls: ChatCompletionMessageToolCall[]) {
    return new Promise((resolve, reject) => {
      const normalizeName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "")
      const toolIndex = this.#tools.map((tool) => ({
        tool,
        name: tool.name,
        normalized: normalizeName(tool.name)
      }))
      const resolveTool = (rawName: string) => {
        const direct = toolIndex.find((entry) => entry.name === rawName)?.tool
        if (direct) return direct
        const normalized = normalizeName(rawName)
        const exactNormalized = toolIndex.find((entry) => entry.normalized === normalized)?.tool
        if (exactNormalized) return exactNormalized
        let best: { tool: Tool; index: number; length: number } | null = null
        for (const entry of toolIndex) {
          const index = normalized.lastIndexOf(entry.normalized)
          if (index === -1) continue
          if (!best || index > best.index || (index === best.index && entry.normalized.length > best.length)) {
            best = { tool: entry.tool, index, length: entry.normalized.length }
          }
        }
        return best?.tool
      }

      Promise.all(
        toolcalls.map(async (toolcall) => {
          const callInfo = toolcall.type === "function" ? toolcall.function : toolcall.custom
          const callArg = toolcall.type === "function" ? toolcall.function.arguments : toolcall.custom.input
          let callName = callInfo.name.trim()
          if (callName.includes("<")) {
            callName = callName.split("<")[0]!.trim()
          }
          callName = callName.split(/\s+/)[0] ?? callName
          const targetTool = resolveTool(callName)
          if (this.#onEvent) {
            this.#onEvent({ type: "tool_call", tool: targetTool?.name ?? callName, input: callArg })
          }
          const result = targetTool
            ? await targetTool.execute(callArg)
            : JSON.stringify({
                success: false,
                error: {
                  code: "UNKNOWN_TOOL",
                  message: `Unknown tool: ${callName}`
                }
              })
          logger.debug(
            { tool: targetTool?.name ?? callName, input: callArg, output: result.slice(0, 200) },
            "tool call"
          )
          if (this.#onEvent) {
            this.#onEvent({ type: "tool_result", tool: targetTool?.name ?? callName, output: result })
          }
          return {
            content: result,
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

  async compactWithPrompt(prompt: string) {
    this.context.push({ role: "user", content: "Summarize" })
    const nr = await requestAPI(this.#model, prompt, this.context)
    if (!nr.choices) return
    this.context = [{ role: "user", content: nr.choices[0]?.message.content ?? "" }]
  }

  async run() {
    this.stepCount = 0
    let nextStepFlag = true

    while (nextStepFlag) {
      if (this.stepCount >= this.maxSteps) {
        logger.warn({ maxSteps: this.maxSteps }, "max steps reached, manual intervention required")
        if (this.#onEvent) this.#onEvent({ type: "max_steps", maxSteps: this.maxSteps })
        this.context.push({
          role: "assistant",
          content: "Max steps reached. Manual intervention or context pruning required."
        })
        if (this.#onStepEnd)
          await Promise.resolve(
            this.#onStepEnd({
              stop: (() => {
                nextStepFlag = false
              }).bind(this),
              stopReason: "max_steps"
            })
          )
        break
      }

      this.stepCount += 1
      if (this.#onEvent) this.#onEvent({ type: "step_start", step: this.stepCount })

      let r: Awaited<ReturnType<typeof requestAPI>> | undefined
      let attempt = 0

      while (attempt < this.maxRetries) {
        try {
          r = await requestAPI(
            this.#model,
            this.instruction,
            this.context,
            this.#tools.map((t) => t.make_schema())
          )
          break
        } catch (error) {
          attempt += 1
          logger.warn({ attempt, error }, "requestAPI failed, retrying")
          if (this.#onEvent) this.#onEvent({ type: "retry", attempt, error })
          if (attempt >= this.maxRetries) {
            logger.error({ error }, "requestAPI failed, max retries reached")
            throw error
          }
          await sleep(1000 * 2 ** (attempt - 1))
        }
      }

      if (!r) break

      let stopReason: StopReason | undefined
      for (const choice of r.choices) {
        switch (choice.finish_reason) {
          case "tool_calls":
            if (choice.message.tool_calls) {
              this.context.push(choice.message)
              await this.#handleToolcalls(choice.message.tool_calls)
            }
            // @ts-expect-error additional prop added by qwen api
            logger.debug({ reasoning: choice.message.reasoning_content }, "model reasoning")
            break
          case "stop":
            nextStepFlag = false
            stopReason = "stop"
            this.context.push({ role: "assistant", content: choice.message.content })
            logger.debug({ message: choice.message.content }, "model output")
            if (this.#onEvent) this.#onEvent({ type: "model_output", content: choice.message.content })
            break
          case "content_filter":
            nextStepFlag = false
            stopReason = "content_filter"
            logger.warn("content filtered")
            if (this.#onEvent) this.#onEvent({ type: "content_filter" })
            break
          case "length":
            logger.warn({ message: choice.message.content }, "output length exceeded")
            if (this.#onEvent) this.#onEvent({ type: "length" })
            await this.compact()
            break
        }
      }

      if (this.#onStepEnd)
        await Promise.resolve(
          this.#onStepEnd({
            APIResponse: r,
            stopReason,
            stop: (() => {
              nextStepFlag = false
            }).bind(this)
          })
        )
      if (this.#onEvent) this.#onEvent({ type: "step_end", step: this.stepCount })
    }
  }

  async generate({ prompt }: { prompt: string }) {
    this.context.push({ role: "user", content: prompt })
    await this.run()
  }
}

export default ToolLoopAgent
