import * as z from "zod"
import BaseFunctionTool from "../base/FunctionTool"
import "dotenv/config"

const serperRespSchema = z.object({
  knowledgeGraph: z.optional(z.object()),
  organic: z.array(
    z.object({
      title: z.string(),
      link: z.url(),
      snippet: z.optional(z.string()),
      date: z.optional(z.string()),
      position: z.number()
    })
  )
})

async function call_search(keywords: string, language?: string) {
  const result = serperRespSchema.parse(
    await (
      await fetch("https://google.serper.dev/search", {
        headers: {
          "X-API-KEY": process.env.SERPER_API_KEY!,
          "Content-Type": "application/json"
        },
        method: "POST",
        body: JSON.stringify({
          q: keywords,
          hl: language
        }),
        redirect: "follow"
      })
    ).json()
  )
  return result
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
  try {
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
  } catch (e) {
    return e instanceof Error ? e.toString() : "Failed to fetch target url!"
  }
}

async function search_serper({ keywords, language }: { keywords: string; language?: string }) {
  try {
    return {
      success: true,
      data: await call_search(keywords, language)
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
  description: "Perform a Google search to find relevant web pages. Returns titles, snippets, and URLs.",
  schema: z.object({
    keywords: z.string().meta({ description: "Search query string." }),
    language: z.optional(z.string()).meta({ description: "Preferred language for results (e.g., 'en', 'zh-cn')." })
  }),
  func: search_serper
})

export const fetchMarkdown = new BaseFunctionTool({
  name: "fetchMarkdown",
  description: "Fetch a URL's content and convert it to Markdown. Supports HTML, PDF, Office docs, etc.",
  schema: z.object({
    url: z.url().meta({ description: "Full URL to fetch (must start with http:// or https://)." })
  }),
  func: url2markdown
})
