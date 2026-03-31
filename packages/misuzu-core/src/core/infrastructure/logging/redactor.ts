const SENSITIVE_FIELD_NAMES = ["apikey", "api_key", "token", "authorization", "password", "secret"]

const MAX_DEPTH = 6

function isSensitiveField(key: string) {
  const normalized = key.toLowerCase()
  return SENSITIVE_FIELD_NAMES.some((sensitiveName) => normalized.includes(sensitiveName))
}

function redactInternal(value: unknown, depth: number, key?: string): unknown {
  if (key && isSensitiveField(key)) {
    return "[REDACTED]"
  }

  if (depth > MAX_DEPTH) {
    return "[MAX_DEPTH]"
  }

  if (value === null || value === undefined) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactInternal(item, depth + 1))
  }

  if (typeof value === "object") {
    const output: Record<string, unknown> = {}
    for (const [entryKey, entryValue] of Object.entries(value)) {
      output[entryKey] = redactInternal(entryValue, depth + 1, entryKey)
    }
    return output
  }

  return value
}

export function redact(value: unknown) {
  return redactInternal(value, 0)
}
