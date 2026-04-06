export function resolveChallengeIdFromTaskPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return undefined
  }

  const challengeId = (payload as { challenge?: unknown }).challenge
  return typeof challengeId === "number" && Number.isFinite(challengeId) ? challengeId : undefined
}

export function resolveEnvPlaceholders(value: unknown): unknown {
  if (typeof value === "string" && value.startsWith("$env:")) {
    const envVar = value.slice(5)
    const envValue = process.env[envVar]
    if (!envValue) {
      throw new Error(`Missing environment variable referenced in config: ${envVar}`)
    }
    return envValue
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveEnvPlaceholders(item))
  }

  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value)) {
      output[key] = resolveEnvPlaceholders(nested)
    }
    return output
  }

  return value
}
