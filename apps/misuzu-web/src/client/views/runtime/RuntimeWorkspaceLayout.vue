<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from "vue"
import { useRoute, useRouter } from "vue-router"
import {
  BotIcon,
  HomeIcon,
  ListChecksIcon,
  PauseCircleIcon,
  PlayCircleIcon,
  PlusIcon,
  RefreshCcwIcon,
  Settings2Icon,
  ShieldCheckIcon,
} from "lucide-vue-next"
import type { RuntimeWorkspaceSnapshot } from "@shared/protocol.ts"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { useRuntimeWorkspace } from "@/composables/use-runtime-workspace.ts"
import AppLayout from "@/components/layout/AppLayout.vue"

const route = useRoute()
const router = useRouter()

const workspaceId = String(route.params.id)
const runtime = useRuntimeWorkspace(workspaceId)

type AgentSidebarStatus =
  | "active"
  | "pause"
  | "pending"
  | "blocked"
  | "stopped"
  | "solved"
  | "model_unassigned"
type SidebarAgent = RuntimeWorkspaceSnapshot["agents"][number] & { status: AgentSidebarStatus }

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
    return workspaceId
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
    }))
    .sort(
      (left, right) =>
        agentStatusWeight(left.status) - agentStatusWeight(right.status) ||
        left.name.localeCompare(right.name),
    )
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
      id: workspaceId,
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
    params: { id: workspaceId },
  })
}

async function openAgent(agentId: string) {
  if (route.name === "runtime-agent" && selectedAgentId.value === agentId) {
    return
  }

  await router.push({
    name: "runtime-agent",
    params: {
      id: workspaceId,
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
    params: { id: workspaceId },
  })
}

function openHome() {
  void router.push({ name: "home" })
}

function openCreateWorkspace() {
  void router.push({ name: "workspace-create" })
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
</script>

<template>
  <AppLayout>
    <template #header-menu>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            :is-active="!isOverviewRoute && !isSettingsRoute"
            @click="openDefaultAgent"
          >
            <BotIcon />
            <span>Chat</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton :is-active="isOverviewRoute" @click="openOverview">
            <ListChecksIcon />
            <span>Queue & Setup</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton :is-active="isSettingsRoute" @click="openSettings">
            <Settings2Icon />
            <span>Settings</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </template>

    <template #sidebar-content>
      <SidebarGroup>
        <SidebarGroupLabel>Agents</SidebarGroupLabel>
        <SidebarGroupContent>
          <ScrollArea class="h-[260px]">
            <SidebarMenu>
              <SidebarMenuItem v-for="agent in sidebarAgents" :key="agent.id">
                <SidebarMenuButton
                  :is-active="selectedAgentId === agent.id && !isOverviewRoute"
                  @click="openAgent(agent.id)"
                >
                  <ShieldCheckIcon v-if="agent.role === 'environment'" />
                  <BotIcon v-else />
                  <span>{{ agent.name }}</span>
                  <Badge class="ml-auto" :variant="statusBadgeVariant(agent.status)">
                    {{ statusLabel(agent.status) }}
                  </Badge>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </ScrollArea>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup>
        <SidebarGroupLabel>Runtime Controls</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton @click="runtime.syncChallenges">
                <RefreshCcwIcon />
                <span>Sync Challenges</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton @click="runtime.syncNotices">
                <RefreshCcwIcon />
                <span>Sync Notices</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem v-if="summary?.paused">
              <SidebarMenuButton @click="runtime.startDispatch(true)">
                <PlayCircleIcon />
                <span>Start Flow</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem v-else>
              <SidebarMenuButton @click="runtime.pauseDispatch">
                <PauseCircleIcon />
                <span>Pause Flow</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem v-if="!summary?.initialized && !summary?.environmentAgentReady">
              <SidebarMenuButton @click="runtime.ensureEnvironmentAgent">
                <ShieldCheckIcon />
                <span>Add Environment Agent</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup>
        <SidebarGroupLabel>Workspace</SidebarGroupLabel>
        <SidebarGroupContent>
          <div class="rounded-lg border border-sidebar-border/80 bg-sidebar-accent/30 p-3">
            <p class="truncate text-[11px] text-sidebar-foreground/70">
              {{ summary?.rootDir ?? workspaceId }}
            </p>
            <div class="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div class="rounded-md border border-sidebar-border/70 bg-sidebar p-2">
                <p class="text-sidebar-foreground/70">Challenges</p>
                <p class="mt-1 text-sm font-semibold">{{ summary?.challenges.length ?? 0 }}</p>
              </div>
              <div class="rounded-md border border-sidebar-border/70 bg-sidebar p-2">
                <p class="text-sidebar-foreground/70">Pending</p>
                <p class="mt-1 text-sm font-semibold">
                  {{ summary?.queue.pendingTaskCount ?? 0 }}
                </p>
              </div>
              <div class="rounded-md border border-sidebar-border/70 bg-sidebar p-2">
                <p class="text-sidebar-foreground/70">Busy</p>
                <p class="mt-1 text-sm font-semibold">
                  {{ summary?.queue.busySolverCount ?? 0 }}
                </p>
              </div>
              <div class="rounded-md border border-sidebar-border/70 bg-sidebar p-2">
                <p class="text-sidebar-foreground/70">State</p>
                <p class="mt-1 text-sm font-semibold">
                  {{ summary?.paused ? "Paused" : "Running" }}
                </p>
              </div>
            </div>
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    </template>

    <template #footer-menu>
      <SidebarMenuItem>
        <SidebarMenuButton @click="openHome">
          <HomeIcon />
          <span>Home</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
      <SidebarMenuItem>
        <SidebarMenuButton @click="openCreateWorkspace">
          <PlusIcon />
          <span>New Workspace</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </template>

    <header class="flex items-center justify-between gap-2 border-b px-4 py-3">
      <div class="flex min-w-0 items-center gap-2">
        <p class="truncate text-sm font-semibold">
          {{ isOverviewRoute ? "Queue & Setup" : isSettingsRoute ? "Settings" : activeAgentName }}
        </p>
      </div>

      <div class="flex items-center gap-2">
        <Badge :variant="summary?.paused ? 'destructive' : 'default'">
          {{ summary?.paused ? "Paused" : "Running" }}
        </Badge>
        <Badge variant="outline" class="hidden sm:inline-flex">
          Pending {{ summary?.queue.pendingTaskCount ?? 0 }}
        </Badge>
      </div>
    </header>

    <section class="px-3 py-3 md:px-4" :class="contentClass">
      <RouterView />
    </section>
  </AppLayout>
</template>
