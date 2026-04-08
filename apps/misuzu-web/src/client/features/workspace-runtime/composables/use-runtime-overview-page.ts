import { computed, reactive, ref, watch } from "vue"
import { useRouter } from "vue-router"
import {
  createDefaultPluginConfigDraft,
  toPluginConfig,
  type AuthMode,
  type ContestMode,
  type PluginConfigDraft,
} from "@/features/workspace-runtime/composables/plugin-config-form.ts"
import { useRuntimeWorkspace } from "@/features/workspace-runtime/composables/use-runtime-workspace.ts"

export function useRuntimeOverviewPage(workspaceId: string) {
  const router = useRouter()
  const runtime = useRuntimeWorkspace(workspaceId)

  const selectedPluginId = ref("")
  const pluginDraft = reactive<PluginConfigDraft>(createDefaultPluginConfigDraft())
  const initError = ref("")
  const initNotice = ref("")
  const queueActionChallengeId = ref<number>()
  const queueActionError = ref("")
  const queueActionNotice = ref("")
  const writeupExporting = ref(false)
  const writeupExportError = ref("")
  const writeupExportNotice = ref("")
  const markSolvedChallengeId = ref<number>()
  const markSolvedError = ref("")
  const markSolvedNotice = ref("")
  const markSolvedPromptOpen = ref(false)
  const markSolvedPromptChallenge = ref<{
    challengeId: number
    title: string
    solverId: string
  }>()
  const markSolvedPromptQueue = ref<
    Array<{ challengeId: number; title: string; solverId: string }>
  >([])

  const snapshot = computed(() => runtime.snapshot.value)
  const activeChallenges = computed(() =>
    (snapshot.value?.challenges ?? []).filter((challenge) => challenge.status === "active"),
  )
  const queuedChallenges = computed(() =>
    (snapshot.value?.challenges ?? []).filter((challenge) => challenge.status === "queued"),
  )
  const solvedChallenges = computed(() =>
    (snapshot.value?.challenges ?? []).filter((challenge) => challenge.status === "solved"),
  )
  const blockedChallenges = computed(() =>
    (snapshot.value?.challenges ?? []).filter(
      (challenge) =>
        challenge.status === "blocked" ||
        challenge.status === "model_unassigned" ||
        challenge.status === "idle",
    ),
  )
  const solvedCount = computed(() => solvedChallenges.value.length)
  const solveRatePercent = computed(() => {
    const total = snapshot.value?.challenges.length ?? 0
    if (total <= 0) {
      return 0
    }

    return Math.round((solvedCount.value / total) * 100)
  })

  watch(
    () => snapshot.value?.challenges,
    (challenges) => {
      if (!challenges || typeof window === "undefined") {
        return
      }

      const queuedChallengeIds = new Set<number>([
        ...markSolvedPromptQueue.value.map((challenge) => challenge.challengeId),
        ...(markSolvedPromptChallenge.value ? [markSolvedPromptChallenge.value.challengeId] : []),
      ])

      for (const challenge of challenges) {
        if (!challenge.hasWriteup || challenge.status === "solved") {
          continue
        }

        const storageKey = buildMarkSolvedHintStorageKey(workspaceId, challenge.challengeId)
        if (window.localStorage.getItem(storageKey)) {
          continue
        }

        window.localStorage.setItem(storageKey, "1")
        if (queuedChallengeIds.has(challenge.challengeId)) {
          continue
        }

        markSolvedPromptQueue.value.push({
          challengeId: challenge.challengeId,
          title: challenge.title,
          solverId: challenge.solverId,
        })
        queuedChallengeIds.add(challenge.challengeId)
      }

      showNextMarkSolvedPromptIfNeeded()
    },
    { immediate: true },
  )

  function showNextMarkSolvedPromptIfNeeded() {
    if (markSolvedPromptOpen.value || markSolvedPromptChallenge.value) {
      return
    }

    const next = markSolvedPromptQueue.value.shift()
    if (!next) {
      return
    }

    markSolvedPromptChallenge.value = next
    markSolvedPromptOpen.value = true
  }

  function dismissMarkSolvedPrompt() {
    markSolvedPromptOpen.value = false
    markSolvedPromptChallenge.value = undefined
    showNextMarkSolvedPromptIfNeeded()
  }

  async function confirmMarkSolvedPrompt() {
    const challengeId = markSolvedPromptChallenge.value?.challengeId
    if (challengeId === undefined) {
      dismissMarkSolvedPrompt()
      return
    }

    await markSolverSolved(challengeId)
    dismissMarkSolvedPrompt()
  }

  async function initializeRuntime() {
    initError.value = ""
    initNotice.value = ""

    try {
      if (!selectedPluginId.value) {
        throw new Error("Please select a plugin")
      }

      initNotice.value =
        "Starting runtime initialization. Browser auth window may open if required."
      await runtime.initializeRuntime(selectedPluginId.value, toPluginConfig(pluginDraft))
      await runtime.syncChallenges()
      initNotice.value = "Runtime initialized and challenges synced"
    } catch (error) {
      initError.value = error instanceof Error ? error.message : String(error)
    }
  }

  function openSolverAgent(agentId: string) {
    void router.push({
      name: "runtime-agent",
      params: {
        id: workspaceId,
        agentId,
      },
    })
  }

  function setContestMode(value: string) {
    pluginDraft.contestMode = value as ContestMode
  }

  function setAuthMode(value: string) {
    pluginDraft.authMode = value as AuthMode
  }

  function badgeVariantForStatus(
    status: "active" | "queued" | "solved" | "blocked" | "idle" | "model_unassigned",
  ) {
    switch (status) {
      case "active":
        return "destructive"
      case "queued":
        return "secondary"
      case "model_unassigned":
        return "outline"
      case "solved":
        return "default"
      case "blocked":
        return "outline"
      case "idle":
        return "outline"
    }
  }

  async function enqueueChallenge(challengeId: number) {
    queueActionError.value = ""
    queueActionNotice.value = ""
    queueActionChallengeId.value = challengeId
    try {
      await runtime.enqueueChallenge(challengeId)
      queueActionNotice.value = `Challenge #${String(challengeId)} enqueued`
    } catch (error) {
      queueActionError.value = error instanceof Error ? error.message : String(error)
    } finally {
      queueActionChallengeId.value = undefined
    }
  }

  async function dequeueChallenge(challengeId: number) {
    queueActionError.value = ""
    queueActionNotice.value = ""
    queueActionChallengeId.value = challengeId
    try {
      await runtime.dequeueChallenge(challengeId)
      queueActionNotice.value = `Challenge #${String(challengeId)} dequeued`
    } catch (error) {
      queueActionError.value = error instanceof Error ? error.message : String(error)
    } finally {
      queueActionChallengeId.value = undefined
    }
  }

  async function resetSolver(challengeId: number) {
    queueActionError.value = ""
    queueActionNotice.value = ""
    queueActionChallengeId.value = challengeId
    try {
      await runtime.resetSolver(challengeId)
      queueActionNotice.value = `Solver reset for challenge #${String(challengeId)}`
    } catch (error) {
      queueActionError.value = error instanceof Error ? error.message : String(error)
    } finally {
      queueActionChallengeId.value = undefined
    }
  }

  async function blockSolver(challengeId: number) {
    queueActionError.value = ""
    queueActionNotice.value = ""
    queueActionChallengeId.value = challengeId
    try {
      await runtime.blockSolver(challengeId)
      queueActionNotice.value = `Solver blocked for challenge #${String(challengeId)}`
    } catch (error) {
      queueActionError.value = error instanceof Error ? error.message : String(error)
    } finally {
      queueActionChallengeId.value = undefined
    }
  }

  async function unblockSolver(challengeId: number) {
    queueActionError.value = ""
    queueActionNotice.value = ""
    queueActionChallengeId.value = challengeId
    try {
      await runtime.unblockSolver(challengeId)
      queueActionNotice.value = `Solver unblocked for challenge #${String(challengeId)}`
    } catch (error) {
      queueActionError.value = error instanceof Error ? error.message : String(error)
    } finally {
      queueActionChallengeId.value = undefined
    }
  }

  async function exportWriteups() {
    writeupExportError.value = ""
    writeupExportNotice.value = ""
    writeupExporting.value = true

    try {
      const exported = await runtime.exportWriteups()
      const blob = new Blob([exported.markdown], {
        type: "text/markdown;charset=utf-8",
      })
      const objectUrl = window.URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = objectUrl
      anchor.download = exported.fileName
      anchor.style.display = "none"
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      window.URL.revokeObjectURL(objectUrl)

      writeupExportNotice.value = `Exported ${String(exported.includedWriteups)} writeups`
    } catch (error) {
      writeupExportError.value = error instanceof Error ? error.message : String(error)
    } finally {
      writeupExporting.value = false
    }
  }

  async function markSolverSolved(challengeId: number, writeupMarkdown?: string) {
    markSolvedError.value = ""
    markSolvedNotice.value = ""
    markSolvedChallengeId.value = challengeId

    try {
      await runtime.markSolverSolved(challengeId, writeupMarkdown)
      markSolvedNotice.value = `Marked challenge #${String(challengeId)} as solved`
    } catch (error) {
      markSolvedError.value = error instanceof Error ? error.message : String(error)
    } finally {
      markSolvedChallengeId.value = undefined
    }
  }

  return {
    runtime,
    snapshot,
    loading: runtime.loading,
    activeChallenges,
    queuedChallenges,
    solvedChallenges,
    blockedChallenges,
    solvedCount,
    solveRatePercent,
    selectedPluginId,
    pluginDraft,
    initError,
    initNotice,
    queueActionChallengeId,
    queueActionError,
    queueActionNotice,
    writeupExporting,
    writeupExportError,
    writeupExportNotice,
    markSolvedChallengeId,
    markSolvedError,
    markSolvedNotice,
    markSolvedPromptOpen,
    markSolvedPromptChallenge,
    initializeRuntime,
    openSolverAgent,
    setContestMode,
    setAuthMode,
    badgeVariantForStatus,
    enqueueChallenge,
    dequeueChallenge,
    resetSolver,
    blockSolver,
    unblockSolver,
    exportWriteups,
    markSolverSolved,
    confirmMarkSolvedPrompt,
    dismissMarkSolvedPrompt,
  }
}

function buildMarkSolvedHintStorageKey(workspaceId: string, challengeId: number) {
  return `misuzu:runtime:mark-solved-hint:${workspaceId}:${String(challengeId)}`
}
