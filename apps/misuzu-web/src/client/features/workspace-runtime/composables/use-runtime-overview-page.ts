import { computed, reactive, ref } from "vue"
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

  const snapshot = computed(() => runtime.snapshot.value)
  const activeChallenges = computed(() =>
    (snapshot.value?.challenges ?? []).filter((challenge) => challenge.status === "active"),
  )
  const queuedChallenges = computed(() =>
    (snapshot.value?.challenges ?? []).filter((challenge) => challenge.status === "queued"),
  )
  const historyChallenges = computed(() =>
    (snapshot.value?.challenges ?? []).filter(
      (challenge) =>
        challenge.status === "solved" ||
        challenge.status === "blocked" ||
        challenge.status === "model_unassigned" ||
        challenge.status === "idle",
    ),
  )

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

  return {
    runtime,
    snapshot,
    loading: runtime.loading,
    activeChallenges,
    queuedChallenges,
    historyChallenges,
    selectedPluginId,
    pluginDraft,
    initError,
    initNotice,
    queueActionChallengeId,
    queueActionError,
    queueActionNotice,
    initializeRuntime,
    openSolverAgent,
    setContestMode,
    setAuthMode,
    badgeVariantForStatus,
    enqueueChallenge,
    dequeueChallenge,
    resetSolver,
  }
}
