import type { RuntimeCreateRequest } from "@shared/protocol.ts"

export type ContestMode = "auto" | "id" | "title" | "url"
export type AuthMode = "manual" | "cookie" | "token" | "credentials"

export interface PluginConfigDraft {
  baseUrl: string
  contestMode: ContestMode
  contestValue: string
  authMode: AuthMode
  cookie: string
  bearerToken: string
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
    authMode: "cookie",
    cookie: "",
    bearerToken: "",
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
  if (draft.authMode === "manual") {
    return { mode: "manual" } as const
  }

  if (draft.authMode === "cookie") {
    const cookie = draft.cookie.trim()
    if (!cookie) {
      throw new Error("Cookie is required when auth mode is cookie")
    }

    return {
      mode: "cookie",
      cookie,
    } as const
  }

  if (draft.authMode === "token") {
    const bearerToken = draft.bearerToken.trim()
    if (!bearerToken) {
      throw new Error("Bearer token is required when auth mode is token")
    }

    return {
      mode: "token",
      bearerToken,
    } as const
  }

  const username = draft.username.trim()
  const password = draft.password.trim()
  const loginUrl = draft.loginUrl.trim()
  const authCheckUrl = draft.authCheckUrl.trim()
  const timeoutSec = Number(draft.timeoutSec)

  if (!username || !password || !loginUrl || !authCheckUrl) {
    throw new Error("Username/password/loginUrl/authCheckUrl are required for credentials auth")
  }

  if (!Number.isFinite(timeoutSec) || timeoutSec <= 0) {
    throw new Error("Auth timeout seconds must be a positive number")
  }

  return {
    mode: "credentials",
    username,
    password,
    loginUrl,
    authCheckUrl,
    timeoutSec,
  } as const
}
