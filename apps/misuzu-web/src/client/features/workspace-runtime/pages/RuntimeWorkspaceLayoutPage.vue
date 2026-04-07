<script setup lang="ts">
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
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { useRuntimeLayoutPage } from "@/features/workspace-runtime/composables/use-runtime-layout-page.ts"
import AppLayout from "@/layouts/AppLayout.vue"
import EmptyPlaceholder from "@/components/ui/empty-placeholder/EmptyPlaceholder.vue"

const {
  runtime,
  workspaceId,
  summary,
  isSetupLocked,
  runtimeReady,
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
  syncChallenges,
  syncNotices,
  startFlow,
  pauseFlow,
  ensureEnvironmentAgent,
  runtimeActionNotice,
  runtimeActionError,
  statusLabel,
  statusBadgeVariant,
} = useRuntimeLayoutPage()
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
        <SidebarMenuItem v-if="!isSetupLocked">
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
      <SidebarGroup class="flex-1">
        <SidebarGroupLabel>Agents</SidebarGroupLabel>
        <SidebarGroupContent class="h-full flex flex-col">
          <ScrollArea class="flex-1">
            <SidebarMenu v-if="sidebarAgents.length > 0">
              <SidebarMenuItem v-for="agent in sidebarAgents" :key="agent.id">
                <SidebarMenuButton
                  :is-active="selectedAgentId === agent.id && !isOverviewRoute"
                  @click="openAgent(agent.id)"
                >
                  <ShieldCheckIcon v-if="agent.role === 'environment'" />
                  <BotIcon v-else />
                  <span>{{ agent.name }}</span>
                  <Badge
                    v-if="agent.role === 'solver' && typeof agent.rank === 'number'"
                    variant="outline"
                    class="ml-auto"
                  >
                    Rank {{ Math.round(agent.rank) }}
                  </Badge>
                  <Badge :variant="statusBadgeVariant(agent.status)">
                    {{ statusLabel(agent.status) }}
                  </Badge>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
            <div v-else class="p-4">
              <EmptyPlaceholder
                title="No agents active"
                description="Agents will appear here when they are assigned tasks."
                class="py-6"
              />
            </div>
          </ScrollArea>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup>
        <SidebarGroupLabel>Runtime Controls</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu v-if="runtimeReady">
            <SidebarMenuItem>
              <SidebarMenuButton @click="syncChallenges">
                <RefreshCcwIcon />
                <span>Sync Challenges</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton @click="syncNotices">
                <RefreshCcwIcon />
                <span>Sync Notices</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem v-if="summary?.paused">
              <SidebarMenuButton @click="startFlow">
                <PlayCircleIcon />
                <span>Start Flow</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem v-else>
              <SidebarMenuButton @click="pauseFlow">
                <PauseCircleIcon />
                <span>Pause Flow</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>

          <SidebarMenu v-else>
            <SidebarMenuItem v-if="!summary?.environmentAgentReady">
              <SidebarMenuButton @click="ensureEnvironmentAgent">
                <ShieldCheckIcon />
                <span>Add Environment Agent</span>
              </SidebarMenuButton>
            </SidebarMenuItem>

            <SidebarMenuItem v-if="summary?.setupPhase === 'env_agent_ready_for_settings'">
              <SidebarMenuButton @click="openSettings">
                <Settings2Icon />
                <span>Finish Plugin Setup</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>

          <p v-if="isSetupLocked" class="px-1 pt-2 text-xs text-muted-foreground">
            Workspace is locked to Environment Agent and Settings until plugin setup completes.
          </p>
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
        <SidebarTrigger class="md:hidden" />
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
        <Badge variant="secondary" class="hidden sm:inline-flex">
          {{ summary?.setupPhase ?? "loading" }}
        </Badge>
      </div>
    </header>

    <section class="px-3 py-3 md:px-4" :class="contentClass">
      <p v-if="runtimeActionNotice" class="mb-2 text-sm text-muted-foreground">
        {{ runtimeActionNotice }}
      </p>
      <p v-if="runtimeActionError" class="mb-2 text-sm text-destructive">
        {{ runtimeActionError }}
      </p>
      <div
        v-if="summary?.setupPhase === 'env_agent_ready_for_settings'"
        class="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 bg-card p-3"
      >
        <p class="text-sm text-muted-foreground">
          Environment Agent adaptation appears complete. Open Settings to finalize plugin config and
          unlock the workspace.
        </p>
        <SidebarMenuButton class="w-fit" @click="openSettings">
          <Settings2Icon />
          <span>Open Settings</span>
        </SidebarMenuButton>
      </div>
      <RouterView />
    </section>
  </AppLayout>
</template>
