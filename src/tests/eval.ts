import * as z from "zod"
import BaseFuntionTool from "./base/FunctionTool"

export const evalTool = new BaseFuntionTool({
  name: "eval",
  description: "evaluate javascript code",
  schema: z.object({
    code: z.string().meta({ description: "the javascript code to run." })
  }),
  func: ({ code }) => {
    const foo = new Function(code)
    return foo()
  }
})

console.log(await evalTool.execute(`{"code": "return 1"}`))
