import * as z from "zod"
import BaseFunctionTool from "../base/FunctionTool"
import "dotenv/config"

function getEnvVar(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Environment variable ${name} is required but not set`)
  }
  return value
}

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
    const apiKey = getEnvVar("SERPER_API_KEY")
  const result = serperRespSchema.parse(
    await (
      await fetch("https://google.serper.dev/search", {
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
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`)
    }
    const origin_html = await response.blob()
    const fd = new FormData()
    // TODO: test if ext name will affect parse result (pdf)
    fd.set("files", origin_html, "html2md.html")
    const raw = await (
      await fetch("https://api.cloudflare.com/client/v4/accounts/d5c2facf4cd13419884d0c4d0bf0f081/ai/tomarkdown", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${getEnvVar("CLOUDFLARE_AI_TOKEN")}`
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
  description:
    "Search the web, return url results. You can use tool `fetchMarkdown` to get the content of certain url.",
  schema: z.object({
    keywords: z.string().meta({ description: "Search keywords, splited with whitespaces(` `)." }),
    language: z
      .optional(z.string())
      .meta({ description: "The language id you expect the search results are in. e.g. en, zh-cn, zh-tw..." })
  }),
  func: search_serper
})

export const fetchMarkdown = new BaseFunctionTool({
  name: "fetchMarkdown",
  description: `Fetch certain url, return markdown type contents.
  Supported MimeTypes: PDF Documents, Images, HTML, XML, Microsoft Office Documents, Open Document Format, CSV, Apple Documents`,
  schema: z.object({
    url: z.url().meta({ description: "Target url started with `http://` or `https://` schema" })
  }),
  func: url2markdown
})
