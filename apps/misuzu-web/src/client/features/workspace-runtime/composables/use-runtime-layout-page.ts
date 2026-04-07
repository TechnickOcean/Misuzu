import { computed, onMounted, onUnmounted, watch } from "vue"
import { useRoute, useRouter } from "vue-router"
import type { RuntimeWorkspaceSnapshot } from "@shared/protocol.ts"
import { useRuntimeWorkspace } from "@/features/workspace-runtime/composables/use-runtime-workspace.ts"

type AgentSidebarStatus =
  | "active"
  | "pause"
  | "pending"
  | "blocked"
  | "stopped"
  | "solved"
  | "model_unassigned"

type SidebarAgent = RuntimeWorkspaceSnapshot["agents"][number] & {
  status: AgentSidebarStatus
  rank?: number
}

export function useRuntimeLayoutPage() {
  const route = useRoute()
  const router = useRouter()

  const workspaceId = computed(() => String(route.params.id))
  const runtime = useRuntimeWorkspace(workspaceId.value)

  const summary = computed(() => runtime.snapshot.value)
  const isOverviewRoute = computed(() => route.name === "runtime-overview")
  const isSettingsRoute = computed(() => route.name === "runtime-settings")
  const selectedAgentId = computed(() =>
    typeof route.params.agentId === "string" ? route.params.agentId : undefined,
  )
  const defaultAgentId = computed(() => {
    const agents = summary.value?.agents ?? []
    return agents.find((agent) => agent.id === "environment")?.id ?? agents[0]?.id
  })
  const activeAgentName = computed(() => {
    const agentId = selectedAgentId.value ?? defaultAgentId.value
    if (!agentId) {
      return workspaceId.value
    }

    return summary.value?.agents.find((agent) => agent.id === agentId)?.name ?? agentId
  })
  const contentClass = computed(() =>
    isOverviewRoute.value || isSettingsRoute.value
      ? "min-h-0 flex-1 overflow-y-auto"
      : "min-h-0 flex-1 overflow-hidden",
  )
  const sidebarAgents = computed<SidebarAgent[]>(() => {
    const snapshot = summary.value
    if (!snapshot) {
      return []
    }

    const challengeById = new Map(
      snapshot.challenges.map((challenge) => [challenge.challengeId, challenge]),
    )
    return snapshot.agents
      .map((agent) => ({
        ...agent,
        status: resolveAgentStatus(snapshot, agent, challengeById.get(agent.challengeId ?? -1)),
        rank: challengeById.get(agent.challengeId ?? -1)?.rank,
      }))
      .sort((left, right) => {
        if (left.role !== right.role) {
          return left.role === "environment" ? -1 : 1
        }

        const leftRank = left.rank ?? Number.NEGATIVE_INFINITY
        const rightRank = right.rank ?? Number.NEGATIVE_INFINITY
        if (leftRank !== rightRank) {
          return rightRank - leftRank
        }

        return (
          agentStatusWeight(left.status) - agentStatusWeight(right.status) ||
          left.name.localeCompare(right.name)
        )
      })
  })

  onMounted(async () => {
    await runtime.open()

    const currentSnapshot = runtime.snapshot.value
    if (currentSnapshot && !currentSnapshot.initialized && !currentSnapshot.environmentAgentReady) {
      await runtime.ensureEnvironmentAgent()
    }

    if (selectedAgentId.value) {
      await runtime.setActiveAgent(selectedAgentId.value)
      return
    }

    await openDefaultAgent()
  })

  onUnmounted(() => {
    runtime.disconnect()
  })

  watch(
    () => route.params.agentId,
    async (agentId) => {
      if (typeof agentId !== "string") {
        return
      }

      await runtime.setActiveAgent(agentId)
    },
  )

  async function openDefaultAgent() {
    const agentId = defaultAgentId.value
    if (!agentId) {
      await openOverview()
      return
    }

    if (route.name === "runtime-agent" && selectedAgentId.value === agentId) {
      return
    }

    await router.replace({
      name: "runtime-agent",
      params: {
        id: workspaceId.value,
        agentId,
      },
    })
  }

  async function openOverview() {
    if (isOverviewRoute.value) {
      return
    }

    await router.push({
      name: "runtime-overview",
      params: { id: workspaceId.value },
    })
  }

  async function openAgent(agentId: string) {
    if (route.name === "runtime-agent" && selectedAgentId.value === agentId) {
      return
    }

    await router.push({
      name: "runtime-agent",
      params: {
        id: workspaceId.value,
        agentId,
      },
    })
  }

  async function openSettings() {
    if (isSettingsRoute.value) {
      return
    }

    await router.push({
      name: "runtime-settings",
      params: { id: workspaceId.value },
    })
  }

  function openHome() {
    void router.push({ name: "home" })
  }

  function openCreateWorkspace() {
    void router.push({ name: "workspace-create" })
  }

  return {
    runtime,
    workspaceId,
    summary,
    isOverviewRoute,
    isSettingsRoute,
    selectedAgentId,
    activeAgentName,
    contentClass,
    sidebarAgents,
    openDefaultAgent,
    openOverview,
    openAgent,
    openSettings,
    openHome,
    openCreateWorkspace,
    statusLabel,
    statusBadgeVariant,
  }
}

function resolveAgentStatus(
  snapshot: RuntimeWorkspaceSnapshot,
  agent: RuntimeWorkspaceSnapshot["agents"][number],
  challenge?: RuntimeWorkspaceSnapshot["challenges"][number],
): AgentSidebarStatus {
  if (agent.role === "environment") {
    if (!snapshot.initialized) {
      return "pending"
    }

    return snapshot.paused ? "pause" : "active"
  }

  if (!challenge) {
    return snapshot.paused ? "pause" : "stopped"
  }

  if (
    snapshot.paused &&
    challenge.status !== "blocked" &&
    challenge.status !== "solved" &&
    challenge.status !== "model_unassigned"
  ) {
    return "pause"
  }

  switch (challenge.status) {
    case "active":
      return "active"
    case "queued":
      return "pending"
    case "blocked":
      return "blocked"
    case "model_unassigned":
      return "model_unassigned"
    case "solved":
      return "solved"
    case "idle":
      return "stopped"
  }
}

function agentStatusWeight(status: AgentSidebarStatus) {
  switch (status) {
    case "active":
      return 0
    case "pause":
      return 1
    case "pending":
      return 2
    case "blocked":
      return 3
    case "model_unassigned":
      return 4
    case "stopped":
      return 5
    case "solved":
      return 6
  }
}

function statusLabel(status: AgentSidebarStatus) {
  switch (status) {
    case "active":
      return "Active"
    case "pause":
      return "Pause"
    case "pending":
      return "Pending"
    case "blocked":
      return "Blocked"
    case "model_unassigned":
      return "No Model"
    case "stopped":
      return "Stopped"
    case "solved":
      return "Solved"
  }
}

function statusBadgeVariant(status: AgentSidebarStatus) {
  switch (status) {
    case "active":
      return "default"
    case "pause":
      return "secondary"
    case "pending":
      return "outline"
    case "blocked":
      return "destructive"
    case "model_unassigned":
      return "outline"
    case "stopped":
      return "outline"
    case "solved":
      return "secondary"
  }
}
