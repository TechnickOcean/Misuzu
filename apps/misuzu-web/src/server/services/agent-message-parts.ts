import type { AgentMessagePart } from "../../shared/protocol.ts"

export function extractMessageParts(content: unknown): AgentMessagePart[] {
  if (typeof content === "string") {
    return [{ kind: "text", text: content }]
  }

  if (!Array.isArray(content)) {
    return []
  }

  const parts: AgentMessagePart[] = []
  for (const item of content) {
    const normalized = normalizeMessagePart(item)
    if (normalized) {
      parts.push(normalized)
    }
  }

  return parts
}

export function renderMessagePartsAsText(parts: AgentMessagePart[]) {
  return parts
    .map((part) => {
      if (part.kind === "text") {
        return part.text
      }

      const lines: string[] = []
      lines.push(part.name ? `[${part.toolType}] ${part.name}` : `[${part.toolType}]`)

      if (part.argsText !== undefined) {
        lines.push(`args: ${part.argsText}`)
      }

      if (part.resultText !== undefined) {
        lines.push(`result: ${part.resultText}`)
      }

      return lines.join("\n")
    })
    .filter((text) => text.trim().length > 0)
    .join("\n\n")
}

function normalizeMessagePart(part: unknown): AgentMessagePart | undefined {
  if (!part || typeof part !== "object") {
    return undefined
  }

  const typedPart = part as Record<string, unknown>
  const partType = typeof typedPart.type === "string" ? typedPart.type : undefined
  if (partType === "text" && typeof typedPart.text === "string") {
    return {
      kind: "text",
      text: typedPart.text,
    }
  }

  if (typeof typedPart.text === "string" && typedPart.text.trim().length > 0) {
    return {
      kind: "text",
      text: typedPart.text,
    }
  }

  const name = readFirstStringField(typedPart, ["toolName", "name", "tool", "label"])
  const args = readFirstDefinedField(typedPart, ["args", "input", "arguments"])
  const result = readFirstDefinedField(typedPart, ["result", "output", "details", "content"])

  if (partType?.includes("tool") || name || args !== undefined || result !== undefined) {
    return {
      kind: "tool",
      toolType: partType ?? "tool",
      name,
      argsText: args === undefined ? undefined : serializeForMessageText(args),
      resultText: result === undefined ? undefined : serializeForMessageText(result),
    }
  }

  return undefined
}

function readFirstStringField(part: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = part[key]
    if (typeof value === "string" && value.trim().length > 0) {
      return value
    }
  }

  return undefined
}

function readFirstDefinedField(part: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = part[key]
    if (value !== undefined) {
      return value
    }
  }

  return undefined
}

function serializeForMessageText(value: unknown) {
  if (typeof value === "string") {
    return value
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
