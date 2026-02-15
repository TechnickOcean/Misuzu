import { fecthMarkdown, websearch } from "@/tools/websearch/websearch"
import ToolLoopAgent from "./base/ToolLoopAgent"

const testAgent = new ToolLoopAgent({
  model: "qwen3-30b-a3b-fp8",
  instruction: "you are a helpful assistant",
  tools: [websearch, fecthMarkdown]
})

testAgent.generate({
  prompt: "帮我搜索京阿尼有哪些动画作品，并作简短介绍。"
})
