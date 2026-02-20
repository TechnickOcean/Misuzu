import { fetchMarkdown, websearch } from "@/tools/websearch/websearch"
import ToolLoopAgent from "./base/ToolLoopAgent"

const testAgent = new ToolLoopAgent({
  model: "qwen3-30b-a3b-fp8",
  instruction: "you are a helpful assistant",
  tools: [websearch, fetchMarkdown]
})

testAgent.generate({
  prompt: "利用你的**所有**工具帮我了解有关“学院偶像大师”的详细信息，确保使用到所有工具：包括 websearch, fetchMarkdown"
})
