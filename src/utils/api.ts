import OpenAI, { type APIPromise } from "openai"
import type { ChatCompletion, ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources"
import "dotenv/config"

const client = new OpenAI({
  apiKey: process.env.OPENAI_TOKEN,
  baseURL: process.env.PROVIDER_URL
})

const function_caller_models = {
  // function calling enabled
  "glm-4.7-flash": "workers-ai/@cf/zai-org/glm-4.7-flash", // 131k
  "llama-4-scout-17b-16e-instruct": "workers-ai/@cf/meta/llama-4-scout-17b-16e-instruct", // 131k
  "qwen3-30b-a3b-fp8": "workers-ai/@cf/qwen/qwen3-30b-a3b-fp8" // 32k
}

const normal_models = {
  // function calling disabled
  "gpt-oss-20b": "workers-ai/@cf/openai/gpt-oss-20b",
  "deepseek-r1-distill-qwen-32b": "workers-ai/@cf/deepseek-ai/deepseek-r1-distill-qwen-32b"
}

const models = {
  ...function_caller_models,
  ...normal_models
}

export type ModelWithTools = keyof typeof function_caller_models
export type ModelWithoutTools = keyof typeof normal_models
export type Model = ModelWithTools | ModelWithoutTools

type ToolsArg<M extends Model> = M extends ModelWithTools ? [tools?: ChatCompletionTool[]] : []

async function requestAPI<M extends Model>(
  model: M,
  system_prompt: string,
  messages: ChatCompletionMessageParam[],
  ...args: ToolsArg<M>
): Promise<APIPromise<ChatCompletion>> {
  const tools = args[0]
  messages = [{ role: "system", content: system_prompt }, ...messages]
  return client.chat.completions.create({
    model: models[model],
    messages,
    ...(tools ? { tools } : {})
  })
}
export default requestAPI
