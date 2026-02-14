import * as z from "zod"
import requestAPI from "@/utils/api"
import BaseFuntionTool from "../tools/base/FunctionTool"

export const evalTool = new BaseFuntionTool({
  name: "eval",
  description: "evaluate javascript code, use `return` for output",
  schema: z.object({
    code: z.string().meta({ description: "the javascript code to run." })
  }),
  func: ({ code }) => {
    const foo = new Function(code)
    return foo()
  }
})

const res = await requestAPI(
  "qwen3-30b-a3b-fp8",
  [{ role: "user", content: "调用eval工具计算前100个质数" }],
  [evalTool.make_schema()]
)

// @ts-expect-error
const call = res.choices[0]?.message.tool_calls[0].function.arguments

console.log(call)

console.log(await evalTool.execute(call))
