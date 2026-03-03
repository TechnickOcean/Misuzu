import * as z from "zod"
import { AppError } from "@/utils/errors"
import BaseFunctionTool from "../base/FunctionTool"

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

async function search_serper(keywords: string, language?: string) {
  const apiKey = process.env.SERPER_API_KEY
  if (!apiKey) {
    throw new AppError("UPSTREAM_ERROR", "SERPER_API_KEY is not configured")
  }

  const response = await fetch("https://google.serper.dev/search", {
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json"
    },
    method: "POST",
    body: JSON.stringify({
      q: keywords,
      hl: language
    }),
    redirect: "follow"
  })

  if (!response.ok) {
    throw new AppError("UPSTREAM_ERROR", "Serper search failed", {
      status: response.status
    })
  }

  const result = serperRespSchema.parse(await response.json())
  return result
}

async function search({ keywords, language }: { keywords: string; language?: string }) {
  return {
    success: true,
    data: await search_serper(keywords, language)
  }
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
  const token = process.env.CLOUDFLARE_AI_TOKEN
  if (!token) {
    throw new AppError("UPSTREAM_ERROR", "CLOUDFLARE_AI_TOKEN is not configured")
  }

  const origin_html = await (await fetch(url)).blob()
  const fd = new FormData()
  // TODO: test if ext name will affect parse result (pdf)
  fd.set("files", origin_html, "html2md.html")
  const response = await fetch(
    "https://api.cloudflare.com/client/v4/accounts/d5c2facf4cd13419884d0c4d0bf0f081/ai/tomarkdown",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`
      },
      body: fd
    }
  )

  if (!response.ok) {
    throw new AppError("UPSTREAM_ERROR", "Cloudflare markdown conversion failed", {
      status: response.status
    })
  }

  const result = cf2mdSchema.parse(await response.json())
  if (!result.success || !result.result || result.result?.length === 0)
    return {
      format: "html",
      result: await origin_html.text()
    }

  return {
    format: "markdown",
    tokens: result.result[0]!.tokens,
    result: result.result[0]!.data
  }
}

export const websearch = new BaseFunctionTool({
  name: "websearch",
  description: "Perform a Google search to find relevant web pages. Returns titles, snippets, and URLs.",
  schema: z.object({
    keywords: z.string().meta({ description: "Search query string." }),
    language: z.optional(z.string()).meta({ description: "Preferred language for results (e.g., 'en', 'zh-cn')." })
  }),
  func: search
})

export const fetchMarkdown = new BaseFunctionTool({
  name: "fetchMarkdown",
  description: "Fetch a URL's content, result in Markdown. Supports HTML, PDF, Office docs, etc.",
  schema: z.object({
    url: z.url().meta({ description: "Full URL to fetch (must start with http:// or https://)." })
  }),
  func: url2markdown
})
