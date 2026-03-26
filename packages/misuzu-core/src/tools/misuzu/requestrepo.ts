import { type Static, Type } from "@sinclair/typebox"

const API_BASE = "https://requestrepo.com/api"

const createSchema = Type.Object({
  token: Type.Optional(
    Type.String({ description: "Auth token (optional, creates anonymous session if omitted)" }),
  ),
})

export const requestrepoCreateTool = {
  name: "requestrepo_create",
  label: "Create requestrepo session",
  description:
    "Create a new requestrepo.com session for out-of-band (OOB) testing. " +
    "Returns a subdomain URL where HTTP requests can be received.",
  parameters: createSchema,
  execute: async (_id: string, rawParams: unknown) => {
    const params = rawParams as Static<typeof createSchema>
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (params.token) headers["Authorization"] = `Bearer ${params.token}`
    const res = await fetch(`${API_BASE}/request`, { method: "POST", headers })
    if (!res.ok)
      throw new Error(`Failed to create requestrepo session: ${res.status} ${res.statusText}`)
    const data = (await res.json()) as { subdomain: string; domain: string }
    const url = `https://${data.subdomain}.${data.domain}`
    return {
      content: [{ type: "text" as const, text: `Session created: ${url}` }],
      details: { subdomain: data.subdomain, domain: data.domain, url },
    }
  },
}

const waitSchema = Type.Object({
  subdomain: Type.String({ description: "Subdomain from requestrepo_create" }),
  timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (default: 30)" })),
})

export const requestrepoWaitTool = {
  name: "requestrepo_wait",
  label: "Wait for request",
  description:
    "Wait for an incoming HTTP request on a requestrepo subdomain. Blocks until a request is received or timeout.",
  parameters: waitSchema,
  execute: async (_id: string, rawParams: unknown) => {
    const params = rawParams as Static<typeof waitSchema>
    const timeoutMs = (params.timeout ?? 30) * 1000
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const res = await fetch(`${API_BASE}/get_requests?subdomain=${params.subdomain}`)
      if (res.ok) {
        const requests = (await res.json()) as Array<{
          method: string
          path: string
          headers: Record<string, string>
          body: string
        }>
        if (requests.length > 0) {
          const req = requests[0]
          return {
            content: [
              {
                type: "text" as const,
                text: `${req.method} ${req.path}\nHeaders: ${JSON.stringify(req.headers, null, 2)}\nBody: ${req.body ?? "(empty)"}`,
              },
            ],
            details: req,
          }
        }
      }
      await new Promise((r) => setTimeout(r, 2000))
    }
    throw new Error(`Timeout waiting for request on ${params.subdomain}`)
  },
}

const setFileSchema = Type.Object({
  subdomain: Type.String({ description: "Subdomain from requestrepo_create" }),
  path: Type.String({ description: "URL path, e.g. '/index.html'" }),
  content: Type.String({ description: "Response body content" }),
  statusCode: Type.Optional(Type.Number({ description: "HTTP status code (default: 200)" })),
  contentType: Type.Optional(
    Type.String({ description: "Content-Type header (default: text/html)" }),
  ),
})

export const requestrepoSetFileTool = {
  name: "requestrepo_set_file",
  label: "Set HTTP response",
  description: "Set a custom HTTP response for a path on the requestrepo subdomain.",
  parameters: setFileSchema,
  execute: async (_id: string, rawParams: unknown) => {
    const params = rawParams as Static<typeof setFileSchema>
    const res = await fetch(`${API_BASE}/set_file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subdomain: params.subdomain,
        path: params.path,
        content: params.content,
        status_code: params.statusCode ?? 200,
        content_type: params.contentType ?? "text/html",
      }),
    })
    if (!res.ok) throw new Error(`Failed to set file: ${res.status}`)
    return {
      content: [
        { type: "text" as const, text: `Response set for ${params.path} on ${params.subdomain}` },
      ],
      details: { subdomain: params.subdomain, path: params.path },
    }
  },
}

const addDnsSchema = Type.Object({
  subdomain: Type.String({ description: "Subdomain from requestrepo_create" }),
  recordType: Type.String({ description: "DNS record type (A, AAAA, CNAME, TXT, MX, NS)" }),
  value: Type.String({ description: "Record value" }),
  name: Type.Optional(Type.String({ description: "Sub-subdomain name (default: '*')" })),
})

export const requestrepoAddDnsTool = {
  name: "requestrepo_add_dns",
  label: "Add DNS record",
  description: "Add a DNS record for the requestrepo subdomain.",
  parameters: addDnsSchema,
  execute: async (_id: string, rawParams: unknown) => {
    const params = rawParams as Static<typeof addDnsSchema>
    const res = await fetch(`${API_BASE}/add_dns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subdomain: params.subdomain,
        type: params.recordType,
        value: params.value,
        name: params.name ?? "*",
      }),
    })
    if (!res.ok) throw new Error(`Failed to add DNS record: ${res.status}`)
    return {
      content: [
        {
          type: "text" as const,
          text: `DNS ${params.recordType} record added for ${params.subdomain}`,
        },
      ],
      details: { subdomain: params.subdomain, type: params.recordType, value: params.value },
    }
  },
}

export const requestrepoTools = [
  requestrepoCreateTool,
  requestrepoWaitTool,
  requestrepoSetFileTool,
  requestrepoAddDnsTool,
]
