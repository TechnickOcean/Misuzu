import { websearch } from "@/tools/websearch/websearch"
import ToolLoopAgent from "./base/ToolLoopAgent"

const testAgent = new ToolLoopAgent({
  model: "qwen3-30b-a3b-fp8",
  instruction: "you are a helpful assistant",
  tools: [websearch],
  onStepEnd: ({ APIResponse }) => {
    APIResponse.choices.forEach(() => {
      console.log(testAgent.context)
    })
  }
})

testAgent.generate({
  prompt: "帮我搜索学园偶像大师初星学院有哪些角色"
})
