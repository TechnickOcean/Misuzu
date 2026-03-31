export interface TruncateOptions {
  maxLines?: number
  maxBytes?: number
}

export interface TruncationResult {
  content: string
  truncated: boolean
  truncatedBy: "lines" | "bytes"
  outputLines: number
  totalLines: number
  outputBytes: number
  totalBytes: number
  maxLines: number
  maxBytes: number
}

export const DEFAULT_MAX_LINES = 100
export const DEFAULT_MAX_BYTES = 50_000

const EMPTY: TruncationResult = {
  content: "",
  truncated: false,
  truncatedBy: "lines",
  outputLines: 0,
  totalLines: 0,
  outputBytes: 0,
  totalBytes: 0,
  maxLines: DEFAULT_MAX_LINES,
  maxBytes: DEFAULT_MAX_BYTES,
}

function makeResult(
  content: string,
  totalLines: number,
  totalBytes: number,
  options: Required<TruncateOptions>,
  truncated: boolean,
  truncatedBy: "lines" | "bytes",
): TruncationResult {
  const outputLines = content ? content.split("\n").length : 0
  return {
    content,
    truncated,
    truncatedBy,
    outputLines,
    totalLines,
    outputBytes: Buffer.byteLength(content, "utf-8"),
    totalBytes,
    maxLines: options.maxLines,
    maxBytes: options.maxBytes,
  }
}

function resolveOptions(options?: TruncateOptions): Required<TruncateOptions> {
  return {
    maxLines: options?.maxLines ?? DEFAULT_MAX_LINES,
    maxBytes: options?.maxBytes ?? DEFAULT_MAX_BYTES,
  }
}

export function truncateHead(content: string, options?: TruncateOptions): TruncationResult {
  if (!content) return EMPTY

  const opts = resolveOptions(options)
  const totalBytes = Buffer.byteLength(content, "utf-8")
  const lines = content.split("\n")
  const totalLines = lines.length

  if (totalBytes <= opts.maxBytes && totalLines <= opts.maxLines) {
    return makeResult(content, totalLines, totalBytes, opts, false, "lines")
  }

  if (totalLines > opts.maxLines) {
    const kept = lines.slice(0, opts.maxLines)
    return makeResult(kept.join("\n"), totalLines, totalBytes, opts, true, "lines")
  }

  let end = opts.maxBytes
  while (end > 0 && (content[end] === "\n" || content[end - 1] === "\n")) end--
  if (end === 0) end = Math.min(opts.maxBytes, content.length)
  const truncated = content.slice(0, end)
  return makeResult(truncated, totalLines, totalBytes, opts, true, "bytes")
}

export function truncateTail(content: string, options?: TruncateOptions): TruncationResult {
  if (!content) return EMPTY

  const opts = resolveOptions(options)
  const totalBytes = Buffer.byteLength(content, "utf-8")
  const lines = content.split("\n")
  const totalLines = lines.length

  if (totalBytes <= opts.maxBytes && totalLines <= opts.maxLines) {
    return makeResult(content, totalLines, totalBytes, opts, false, "lines")
  }

  if (totalLines > opts.maxLines) {
    const kept = lines.slice(-opts.maxLines)
    return makeResult(kept.join("\n"), totalLines, totalBytes, opts, true, "lines")
  }

  let start = content.length - opts.maxBytes
  if (start < 0) start = 0
  while (start < content.length && content[start] !== "\n") start++
  if (start < content.length) start++
  const truncated = content.slice(start)
  return makeResult(truncated, totalLines, totalBytes, opts, true, "bytes")
}

export function truncateLine(line: string, maxBytes: number) {
  if (Buffer.byteLength(line, "utf-8") <= maxBytes) return line
  return line.slice(0, maxBytes) + "\n[...line truncated]"
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1048576).toFixed(1)}MB`
}
