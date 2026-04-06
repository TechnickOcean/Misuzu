import type { ContestBinding, ContestSummary } from "../../../../../../../plugins/index.ts"

export interface PlatformContestManagerOptions {
  onStateChanged?: () => void
}

export interface PlatformContestManagerInitOptions {
  binding: ContestBinding
  restoredContestId?: number
}

export class PlatformContestManager {
  private binding: ContestBinding = { mode: "auto" }
  private contestId?: number
  private readonly onStateChanged: () => void

  constructor(options: PlatformContestManagerOptions = {}) {
    this.onStateChanged = options.onStateChanged ?? (() => {})
  }

  initialize(options: PlatformContestManagerInitOptions) {
    this.binding = options.binding
    this.contestId = options.restoredContestId
  }

  getContestIdState() {
    return this.contestId
  }

  async resolveContestId(loadContests: () => Promise<ContestSummary[]>) {
    const contests = await loadContests()
    if (contests.length === 0) {
      throw new Error("No contests found for this platform")
    }

    if (typeof this.contestId === "number") {
      if (contests.some((contest) => contest.id === this.contestId)) {
        return this.contestId
      }

      this.setContestId(undefined)
    }

    const selected = selectContestByBinding(contests, this.binding)
    if (!selected) {
      throw new Error(`Unable to bind contest for mode: ${this.binding.mode}`)
    }

    this.setContestId(selected.id)
    return selected.id
  }

  private setContestId(contestId: number | undefined) {
    this.contestId = contestId
    this.onStateChanged()
  }
}

function selectContestByBinding(contests: ContestSummary[], binding: ContestBinding) {
  switch (binding.mode) {
    case "id":
      return contests.find((contest) => contest.id === binding.value)
    case "title":
      return contests.find((contest) => contest.title === binding.value)
    case "url": {
      const contestId = parseContestIdFromUrl(binding.value)
      return contests.find((contest) => contest.id === contestId)
    }
    case "auto": {
      const now = Date.now()
      return (
        contests.find(
          (contest) =>
            typeof contest.start === "number" &&
            typeof contest.end === "number" &&
            contest.start <= now &&
            now <= contest.end,
        ) ?? contests[0]
      )
    }
  }
}

function parseContestIdFromUrl(url: string) {
  const match = /\/games\/(\d+)/.exec(url)
  if (!match) {
    throw new Error(`Unable to parse contest id from URL: ${url}`)
  }

  return Number(match[1])
}
