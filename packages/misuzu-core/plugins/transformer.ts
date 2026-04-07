export interface PluginToolTransformerOptions {
  namespace?: string
}

export interface SolverToolPlugin {
  meta: {
    id: string
    name: string
  }
  listChallenges(): Promise<unknown>
  getChallenge(challengeId: number): Promise<unknown>
  submitFlagRaw(challengeId: number, flag: string): Promise<unknown>
  downloadAttachment?(
    challengeId: number,
    attachmentIndex: number,
    fileName?: string,
  ): Promise<unknown>
  openContainer?(challengeId: number): Promise<unknown>
  destroyContainer?(challengeId: number): Promise<unknown>
}

export interface PluginTool {
  name: string
  label: string
  description: string
  parameters: Record<string, unknown>
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: (update: unknown) => void,
  ) => Promise<{
    content: Array<{ type: "text"; text: string }>
    details: unknown
  }>
}

interface RateLimitRule {
  bucket: string
  limit: number
  windowMs: number
}

interface RateLimitVerdict {
  allowed: boolean
  retryAfterMs: number
}

class SlidingWindowRateLimiter {
  private readonly bucketHistory = new Map<string, number[]>()

  consume(rule: RateLimitRule): RateLimitVerdict {
    const now = Date.now()
    const windowStart = now - rule.windowMs
    const history = this.bucketHistory.get(rule.bucket) ?? []
    const activeHistory = history.filter((timestamp) => timestamp > windowStart)

    if (activeHistory.length >= rule.limit) {
      const retryAfterMs = Math.max(1, rule.windowMs - (now - activeHistory[0]))
      this.bucketHistory.set(rule.bucket, activeHistory)
      return {
        allowed: false,
        retryAfterMs,
      }
    }

    activeHistory.push(now)
    this.bucketHistory.set(rule.bucket, activeHistory)
    return {
      allowed: true,
      retryAfterMs: 0,
    }
  }
}

const SENSITIVE_MUTATION_RULE: RateLimitRule = {
  bucket: "sensitive-mutation",
  limit: 3,
  windowMs: 60_000,
}

const GENERAL_QUERY_RULE: RateLimitRule = {
  bucket: "general-query",
  limit: 24,
  windowMs: 60_000,
}

const challengeIdSchema = {
  type: "object",
  properties: {
    challengeId: {
      type: "number",
      description: "Challenge id",
    },
  },
  required: ["challengeId"],
  additionalProperties: false,
} as const

const submitFlagSchema = {
  type: "object",
  properties: {
    challengeId: {
      type: "number",
      description: "Challenge id",
    },
    flag: {
      type: "string",
      description: "Flag candidate to submit",
    },
  },
  required: ["challengeId", "flag"],
  additionalProperties: false,
} as const

const downloadAttachmentSchema = {
  type: "object",
  properties: {
    challengeId: {
      type: "number",
      description: "Challenge id",
    },
    attachmentIndex: {
      type: "number",
      description: "Zero-based attachment index from get_challenge response",
    },
    fileName: {
      type: "string",
      description: "Optional output file name override",
    },
  },
  required: ["challengeId", "attachmentIndex"],
  additionalProperties: false,
} as const

function normalizeNamespace(namespace: string) {
  return namespace
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

function createResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    details: data,
  }
}

function createRateLimitResult(toolName: string, verdict: RateLimitVerdict, rule: RateLimitRule) {
  const retryAfterSec = Math.ceil(verdict.retryAfterMs / 1000)
  const text = [
    `Tool rate limit triggered: ${toolName}.`,
    "Too many requests. Do not brute-force the platform.",
    "Analyze offline first and only make minimal, necessary platform requests.",
    `Retry after ${retryAfterSec}s.`,
  ].join("\n")

  return {
    content: [{ type: "text" as const, text }],
    details: {
      rateLimited: true,
      tool: toolName,
      retryAfterMs: verdict.retryAfterMs,
      limit: rule.limit,
      windowMs: rule.windowMs,
    },
  }
}

function withRateLimit(
  tool: PluginTool,
  limiter: SlidingWindowRateLimiter,
  rule: RateLimitRule,
): PluginTool {
  return {
    ...tool,
    async execute(toolCallId, params, signal, onUpdate) {
      const verdict = limiter.consume(rule)
      if (!verdict.allowed) {
        return createRateLimitResult(tool.name, verdict, rule)
      }

      return tool.execute(toolCallId, params, signal, onUpdate)
    },
  }
}

export function transformPluginToTools(
  plugin: SolverToolPlugin,
  options: PluginToolTransformerOptions = {},
): PluginTool[] {
  const namespace = normalizeNamespace(options.namespace ?? plugin.meta.id)
  const prefix = namespace.length > 0 ? `${namespace}_` : ""

  const tools: PluginTool[] = []
  const limiter = new SlidingWindowRateLimiter()

  tools.push(
    withRateLimit(
      {
        name: `${prefix}get_challenge`,
        label: `${prefix}get_challenge`,
        description: "Get full challenge detail including content, hints, and attachments.",
        parameters: challengeIdSchema,
        async execute(_toolCallId, params) {
          return createResult(await plugin.getChallenge(params.challengeId as number))
        },
      },
      limiter,
      GENERAL_QUERY_RULE,
    ),
  )

  tools.push(
    withRateLimit(
      {
        name: `${prefix}submit_flag`,
        label: `${prefix}submit_flag`,
        description: "Submit a challenge flag and return normalized verdict result.",
        parameters: submitFlagSchema,
        async execute(_toolCallId, params) {
          return createResult(
            await plugin.submitFlagRaw(params.challengeId as number, params.flag as string),
          )
        },
      },
      limiter,
      SENSITIVE_MUTATION_RULE,
    ),
  )

  if (plugin.downloadAttachment) {
    tools.push(
      withRateLimit(
        {
          name: `${prefix}download_attachment`,
          label: `${prefix}download_attachment`,
          description:
            "Download challenge attachment with runtime authentication and save it to solver workspace.",
          parameters: downloadAttachmentSchema,
          async execute(_toolCallId, params) {
            return createResult(
              await plugin.downloadAttachment!(
                params.challengeId as number,
                params.attachmentIndex as number,
                params.fileName as string | undefined,
              ),
            )
          },
        },
        limiter,
        GENERAL_QUERY_RULE,
      ),
    )
  }

  if (plugin.openContainer) {
    tools.push(
      withRateLimit(
        {
          name: `${prefix}open_container`,
          label: `${prefix}open_container`,
          description: "Open/start challenge container and return updated challenge detail.",
          parameters: challengeIdSchema,
          async execute(_toolCallId, params) {
            return createResult(await plugin.openContainer!(params.challengeId as number))
          },
        },
        limiter,
        SENSITIVE_MUTATION_RULE,
      ),
    )
  }

  if (plugin.destroyContainer) {
    tools.push(
      withRateLimit(
        {
          name: `${prefix}destroy_container`,
          label: `${prefix}destroy_container`,
          description: "Destroy challenge container and return updated challenge detail.",
          parameters: challengeIdSchema,
          async execute(_toolCallId, params) {
            return createResult(await plugin.destroyContainer!(params.challengeId as number))
          },
        },
        limiter,
        SENSITIVE_MUTATION_RULE,
      ),
    )
  }

  return tools
}
