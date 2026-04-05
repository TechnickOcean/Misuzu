import { describe, expect, test } from "vite-plus/test"
import { type SolverToolPlugin, transformPluginToTools } from "./transformer.ts"

function createMockPlugin(): SolverToolPlugin {
  return {
    meta: {
      id: "mock-platform",
      name: "Mock Platform",
    },
    async listChallenges() {
      return [{ id: 101, title: "ez", category: "misc", score: 100, solvedCount: 10 }]
    },
    async getChallenge(challengeId: number) {
      return {
        id: challengeId,
        title: "ez",
        category: "misc",
        score: 100,
        content: "content",
        hints: [],
        requiresContainer: false,
        attempts: 0,
        attachments: [],
      }
    },
    async submitFlagRaw(challengeId: number, flag: string) {
      return {
        submissionId: 11,
        status: `${challengeId}:${flag}`,
        accepted: false,
      }
    },
    async openContainer(challengeId: number) {
      return {
        id: challengeId,
        title: "container",
        category: "pwn",
        score: 200,
        content: "",
        hints: [],
        requiresContainer: true,
        attempts: 0,
        attachments: [],
        container: {
          entry: "127.0.0.1:10000",
          closeTime: Date.now() + 1000,
        },
      }
    },
    async destroyContainer(challengeId: number) {
      return {
        id: challengeId,
        title: "container",
        category: "pwn",
        score: 200,
        content: "",
        hints: [],
        requiresContainer: true,
        attempts: 0,
        attachments: [],
        container: {
          entry: null,
          closeTime: null,
        },
      }
    },
  }
}

describe("plugin to tools transformer", () => {
  test("creates solver-facing tools", () => {
    const tools = transformPluginToTools(createMockPlugin())
    const names = tools.map((tool) => tool.name)

    expect(names).toEqual([
      "mock_platform_list_challenges",
      "mock_platform_get_challenge",
      "mock_platform_submit_flag",
      "mock_platform_open_container",
      "mock_platform_destroy_container",
    ])
  })

  test("does not expose runtime-only methods as tools", () => {
    const tools = transformPluginToTools(createMockPlugin())
    const names = tools.map((tool) => tool.name)

    expect(names).not.toContain("mock_platform_poll_updates")
    expect(names).not.toContain("mock_platform_validate_session")
    expect(names).not.toContain("mock_platform_list_contests")
  })

  test("wraps plugin method output as tool result", async () => {
    const tools = transformPluginToTools(createMockPlugin(), {
      namespace: "gzctf",
    })
    const submitTool = tools.find((tool) => tool.name === "gzctf_submit_flag")
    expect(submitTool).toBeDefined()

    const result = await submitTool!.execute("tool-call", {
      challengeId: 31,
      flag: "nctf{demo}",
    })

    expect(result.details).toEqual({
      submissionId: 11,
      status: "31:nctf{demo}",
      accepted: false,
    })
  })

  test("enforces strict sliding window limit on submit and container tools", async () => {
    const tools = transformPluginToTools(createMockPlugin())
    const submitTool = tools.find((tool) => tool.name === "mock_platform_submit_flag")
    const openContainerTool = tools.find((tool) => tool.name === "mock_platform_open_container")

    expect(submitTool).toBeDefined()
    expect(openContainerTool).toBeDefined()

    await submitTool!.execute("tool-call-1", { challengeId: 1, flag: "nctf{a}" })
    await openContainerTool!.execute("tool-call-2", { challengeId: 1 })
    await submitTool!.execute("tool-call-3", { challengeId: 1, flag: "nctf{b}" })

    const rateLimitedResult = await submitTool!.execute("tool-call-4", {
      challengeId: 1,
      flag: "nctf{c}",
    })

    expect((rateLimitedResult.details as { rateLimited?: boolean }).rateLimited).toBe(true)
    expect(rateLimitedResult.content[0].text).toContain("Do not brute-force the platform")
  })

  test("keeps query tools with looser rate limit", async () => {
    const tools = transformPluginToTools(createMockPlugin())
    const getChallengeTool = tools.find((tool) => tool.name === "mock_platform_get_challenge")
    expect(getChallengeTool).toBeDefined()

    const results = await Promise.all([
      getChallengeTool!.execute("q1", { challengeId: 1 }),
      getChallengeTool!.execute("q2", { challengeId: 2 }),
      getChallengeTool!.execute("q3", { challengeId: 3 }),
      getChallengeTool!.execute("q4", { challengeId: 4 }),
    ])

    for (const result of results) {
      expect((result.details as { rateLimited?: boolean }).rateLimited).not.toBe(true)
    }
  })
})
