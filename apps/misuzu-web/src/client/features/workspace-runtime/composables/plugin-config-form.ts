import type { RuntimeCreateRequest } from "@shared/protocol.ts"

export type ContestMode = "auto" | "id" | "title" | "url"
export type AuthMode = "manual" | "credentials"

export interface PluginConfigDraft {
  baseUrl: string
  contestMode: ContestMode
  contestValue: string
  authMode: AuthMode
  username: string
  password: string
  loginUrl: string
  authCheckUrl: string
  timeoutSec: string
}

export function createDefaultPluginConfigDraft(): PluginConfigDraft {
  return {
    baseUrl: "https://example.com",
    contestMode: "auto",
    contestValue: "",
    authMode: "manual",
    username: "",
    password: "",
    loginUrl: "",
    authCheckUrl: "",
    timeoutSec: "120",
  }
}

export function toPluginConfig(
  draft: PluginConfigDraft,
): NonNullable<RuntimeCreateRequest["pluginConfig"]> {
  const baseUrl = draft.baseUrl.trim()
  if (!baseUrl) {
    throw new Error("Plugin baseUrl is required")
  }

  const contest = resolveContestConfig(draft)

  return {
    baseUrl,
    contest,
    auth: resolveAuthConfig(draft),
  }
}

export function fromPluginConfig(config: any): PluginConfigDraft {
  const draft = createDefaultPluginConfigDraft()
  if (!config) {
    return draft
  }

  if (config.baseUrl) {
    draft.baseUrl = config.baseUrl
  }

  if (config.contest) {
    draft.contestMode = config.contest.mode || "auto"
    if (draft.contestMode !== "auto") {
      draft.contestValue = String(config.contest.value || "")
    }
  }

  if (config.auth) {
    draft.authMode = config.auth.mode || "manual"
    if (draft.authMode === "credentials") {
      draft.username = config.auth.username || ""
      draft.password = config.auth.password || ""
    }
    if (config.auth.loginUrl) {
      draft.loginUrl = config.auth.loginUrl
    }
    if (config.auth.authCheckUrl) {
      draft.authCheckUrl = config.auth.authCheckUrl
    }
    if (config.auth.timeoutSec) {
      draft.timeoutSec = String(config.auth.timeoutSec)
    }
  }

  return draft
}

function resolveContestConfig(draft: PluginConfigDraft) {
  if (draft.contestMode === "auto") {
    return { mode: "auto" } as const
  }

  const value = draft.contestValue.trim()
  if (!value) {
    throw new Error("Contest value is required for selected contest mode")
  }

  if (draft.contestMode === "id") {
    const numericValue = Number(value)
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      throw new Error("Contest id must be a positive number")
    }

    return {
      mode: "id",
      value: numericValue,
    } as const
  }

  if (draft.contestMode === "title") {
    return {
      mode: "title",
      value,
    } as const
  }

  return {
    mode: "url",
    value,
  } as const
}

function resolveAuthConfig(draft: PluginConfigDraft) {
  const loginUrl = draft.loginUrl.trim()
  const authCheckUrl = draft.authCheckUrl.trim()
  const timeoutSec = Number(draft.timeoutSec)

  if (draft.timeoutSec.trim().length > 0 && (!Number.isFinite(timeoutSec) || timeoutSec <= 0)) {
    throw new Error("Auth timeout seconds must be a positive number")
  }

  if (draft.authMode === "manual") {
    return {
      mode: "manual",
      ...(loginUrl ? { loginUrl } : {}),
      ...(authCheckUrl ? { authCheckUrl } : {}),
      ...(Number.isFinite(timeoutSec) ? { timeoutSec } : {}),
    } as const
  }

  const username = draft.username.trim()
  const password = draft.password.trim()

  if (!username || !password) {
    throw new Error("Username and password are required for credentials auth")
  }

  return {
    mode: "credentials",
    username,
    password,
    ...(loginUrl ? { loginUrl } : {}),
    ...(authCheckUrl ? { authCheckUrl } : {}),
    ...(Number.isFinite(timeoutSec) ? { timeoutSec } : {}),
  } as const
}
