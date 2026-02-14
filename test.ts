import * as z from "zod"

const foo = z.object({
  foo: z.string().meta({ description: "bar" }),
  foobaz: z.string().meta({ description: "barbaz" })
})

console.log(foo.toJSONSchema())
