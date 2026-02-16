import OpenAI, { type APIPromise } from "openai"
import type { ChatCompletion, ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources"
import "dotenv/config"

function getEnvVar(name: string, defaultValue?: string): string {
  const value = process.env[name] || defaultValue
  if (!value) {
    throw new Error(`Environment variable ${name} is required but not set`)
  }
  return value
}

const client = new OpenAI({
  apiKey: getEnvVar("OPENAI_TOKEN"),
  baseURL: getEnvVar("PROVIDER_URL", "https://api.openai.com/v1"),
})

const function_caller_models = {
  // function calling enabled
  "glm-4.7-flash": "workers-ai/@cf/zai-org/glm-4.7-flash", // 131k
  "llama-4-scout-17b-16e-instruct": "workers-ai/@cf/meta/llama-4-scout-17b-16e-instruct", // 131k
  "qwen3-30b-a3b-fp8": "workers-ai/@cf/qwen/qwen3-30b-a3b-fp8" // 32k
} as const

const normal_models = {
  // function calling disabled
  "gpt-oss-20b": "workers-ai/@cf/openai/gpt-oss-20b",
  "deepseek-r1-distill-qwen-32b": "workers-ai/@cf/deepseek-ai/deepseek-r1-distill-qwen-32b"
} as const

const models = {
  ...function_caller_models,
  ...normal_models
} as const

export type ModelWithTools = keyof typeof function_caller_models
export type ModelWithoutTools = keyof typeof normal_models
export type Model = ModelWithTools | ModelWithoutTools

type ToolsArg<M extends Model> = M extends ModelWithTools ? [tools?: ChatCompletionTool[]] : []

async function requestAPI<M extends Model>(
  model: M,
  messages: ChatCompletionMessageParam[],
  ...args: ToolsArg<M>
): Promise<APIPromise<ChatCompletion>> {
  const tools = args[0]
  
  const modelId = models[model]
  if (!modelId) {
    throw new Error(`Model ID not found for model: ${model}`)
  }

  try {
    return client.chat.completions.create({
      model: models[model],
      messages,
      ...(tools ? { tools } : {})
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    throw new Error(`API request failed for model ${model}: ${errorMessage}`)
  }
}
export default requestAPI
