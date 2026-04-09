import { describe, expect, test } from "vite-plus/test"
import type { OAuthCredentials } from "@mariozechner/pi-ai/oauth"
import { ProviderRegistry, type OAuthCredentialsRefreshUpdate } from "./registry.ts"

describe("ProviderRegistry OAuth token refresh", () => {
  test("refreshes OAuth api key asynchronously and notifies listener", async () => {
    const registry = new ProviderRegistry()
    const updates: OAuthCredentialsRefreshUpdate[] = []
    registry.setOAuthCredentialsRefreshListener((update) => {
      updates.push(update)
    })

    const credentials: OAuthCredentials = {
      refresh: "refresh-token",
      access: "access-token",
      expires: Date.now() + 60_000,
      enterpriseUrl: undefined,
    }

    registry.registerOAuthCredentials({
      provider: "github-copilot",
      oauthProvider: "github-copilot",
      credentials,
      autoRefresh: true,
    })

    const apiKey = await registry.getApiKeyAsync("github-copilot")

    expect(apiKey).toBe("access-token")
    expect(updates).toHaveLength(1)
    expect(updates[0]).toEqual({
      provider: "github-copilot",
      oauthProvider: "github-copilot",
      credentials,
      autoRefresh: true,
    })
  })

  test("falls back to cached oauth api key when auto refresh disabled", async () => {
    const registry = new ProviderRegistry()
    const updates: OAuthCredentialsRefreshUpdate[] = []
    registry.setOAuthCredentialsRefreshListener((update) => {
      updates.push(update)
    })

    registry.registerOAuthCredentials({
      provider: "github-copilot",
      oauthProvider: "github-copilot",
      credentials: {
        refresh: "refresh-token",
        access: "cached-access-token",
        expires: Date.now() - 60_000,
      },
      autoRefresh: false,
    })

    const apiKey = await registry.getApiKeyAsync("github-copilot")

    expect(apiKey).toBe("cached-access-token")
    expect(updates).toHaveLength(0)
  })
})
