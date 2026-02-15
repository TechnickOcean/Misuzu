import { $ } from "bun"
import * as z from "zod"
import BaseFunctionTool from "../base/FunctionTool"
import "dotenv/config"

//? ddg for now, https://serper.dev/ is better

async function call_search(keywords: string) {
  const searchResultSchema = z.object({
    success: z.boolean(),
    data: z.optional(
      z.array(
        z.object({
          title: z.string(),
          url: z.url(),
          description: z.string()
        })
      )
    )
  })
  const result = searchResultSchema.parse(await $`python search.py ${keywords}`.cwd(__dirname).json())
  if (!result.success) throw "Failed to search!"
  if (!result.data) throw "There's no result!"
  return result.data
}

async function url2markdown({ url }: { url: string }) {
  const cf2mdSchema = z.object({
    success: z.boolean(),
    result: z.optional(
      z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          mimeType: z.string(),
          format: z.string(),
          tokens: z.number(),
          data: z.string()
        })
      )
    )
  })
  const origin_html = await (await fetch(url)).blob()
  const fd = new FormData()
  // TODO: test if ext name will affect parse result (pdf)
  fd.set("files", origin_html, "html2md.html")
  const raw = await (
    await fetch("https://api.cloudflare.com/client/v4/accounts/d5c2facf4cd13419884d0c4d0bf0f081/ai/tomarkdown", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.CLOUDFLARE_AI_TOKEN}`
      },
      body: fd
    })
  ).json()
  const result = cf2mdSchema.parse(raw)
  if (!result.success || !result.result || result.result?.length === 0)
    return {
      format: "html",
      result: await origin_html.text()
    }
  else
    return {
      format: "markdown",
      tokens: result.result[0]!.tokens,
      result: result.result[0]!.data
    }
}

async function parsed_results({ keywords }: { keywords: string }) {
  try {
    const raw_results = await call_search(keywords)
    return {
      success: true,
      data: await Promise.all(
        raw_results.map(async (r) => {
          let content: Awaited<ReturnType<typeof url2markdown>> | undefined
          try {
            content = await url2markdown({ url: r.url })
          } catch {
            return undefined
          }
          return {
            ...r,
            content
            // TODO: may excceed max tokens, consider take a slice
          }
        })
      )
    }
  } catch (e) {
    return {
      success: false,
      reason: e instanceof Object ? e.toString() : "Unknown error occurred!"
    }
  }
}

export const websearch = new BaseFunctionTool({
  name: "websearch",
  description: "Search the web",
  schema: z.object({
    keywords: z.string().meta({ description: "Search keywords, splited with whitespaces(` `)." })
  }),
  func: parsed_results
})

export const fecthMarkdown = new BaseFunctionTool({
  name: "fecthMarkdown",
  description: `Fetch certain url, return markdown type contents.
  Supported MimeTypes: PDF Documents, Images, HTML, XML, Microsoft Office Documents, Open Document Format, CSV, Apple Documents`,
  schema: z.object({
    url: z.url().meta({ description: "Target url started with `http://` or `https://` schema" })
  }),
  func: url2markdown
})

await websearch.execute('{"keywords": "学园偶像大师"}')
