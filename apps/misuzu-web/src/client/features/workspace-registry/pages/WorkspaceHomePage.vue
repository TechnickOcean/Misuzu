<script setup lang="ts">
import { LayoutDashboardIcon, PlusIcon, RefreshCcwIcon, WorkflowIcon } from "lucide-vue-next"
import { Badge } from "@/components/ui/badge"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import WorkspaceCard from "@/features/workspace-registry/components/WorkspaceCard.vue"
import { useWorkspaceHomePage } from "@/features/workspace-registry/composables/use-workspace-home-page.ts"
import AppLayout from "@/layouts/AppLayout.vue"

const {
  entries,
  loading,
  refreshEntries,
  runtimeCount,
  solverCount,
  initializedRuntimeCount,
  pendingRuntimeCount,
  latestWorkspace,
  openWorkspace,
  openCreateWorkspace,
} = useWorkspaceHomePage()
</script>

<template>
  <AppLayout>
    <template #header-menu>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton :is-active="true">
            <LayoutDashboardIcon />
            <span>Workspace Dashboard</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </template>

    <template #sidebar-content>
      <SidebarGroup>
        <SidebarGroupLabel>Actions</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton @click="refreshEntries">
                <RefreshCcwIcon />
                <span>Refresh Registry</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton @click="openCreateWorkspace">
                <PlusIcon />
                <span>Create Workspace</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup>
        <SidebarGroupLabel>Workspace Metrics</SidebarGroupLabel>
        <SidebarGroupContent>
          <div class="grid grid-cols-2 gap-2 text-xs">
            <div class="rounded-md border border-sidebar-border/70 bg-sidebar p-2">
              <p class="text-sidebar-foreground/70">Total</p>
              <p class="mt-1 text-sm font-semibold">{{ entries.length }}</p>
            </div>
            <div class="rounded-md border border-sidebar-border/70 bg-sidebar p-2">
              <p class="text-sidebar-foreground/70">Solver</p>
              <p class="mt-1 text-sm font-semibold">{{ solverCount }}</p>
            </div>
            <div class="rounded-md border border-sidebar-border/70 bg-sidebar p-2">
              <p class="text-sidebar-foreground/70">Runtime Up</p>
              <p class="mt-1 text-sm font-semibold">{{ initializedRuntimeCount }}</p>
            </div>
            <div class="rounded-md border border-sidebar-border/70 bg-sidebar p-2">
              <p class="text-sidebar-foreground/70">Runtime Pending</p>
              <p class="mt-1 text-sm font-semibold">{{ pendingRuntimeCount }}</p>
            </div>
          </div>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup>
        <SidebarGroupLabel>Latest Activity</SidebarGroupLabel>
        <SidebarGroupContent>
          <div class="rounded-lg border border-sidebar-border/80 bg-sidebar-accent/30 p-3">
            <div v-if="latestWorkspace" class="space-y-1 text-xs">
              <p class="font-medium">{{ latestWorkspace.name }}</p>
              <p class="text-sidebar-foreground/70">
                {{ new Date(latestWorkspace.updatedAt).toLocaleString() }}
              </p>
            </div>
            <p v-else class="text-xs text-sidebar-foreground/70">No workspace activity yet.</p>
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    </template>

    <template #footer-menu>
      <SidebarMenuItem>
        <SidebarMenuButton>
          <WorkflowIcon />
          <span>{{ entries.length }} Registry Entries</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </template>

    <header class="flex items-center justify-between gap-2 border-b px-4 py-3">
      <div>
        <p class="text-sm font-semibold">Workspace Registry</p>
        <p class="text-xs text-muted-foreground">
          Persisted entries restored from backend storage.
        </p>
      </div>
      <Badge variant="secondary">{{ entries.length }} entries</Badge>
    </header>

    <section class="space-y-3 px-3 py-3 md:px-4">
      <p v-if="loading" class="text-sm text-muted-foreground">Loading workspace registry...</p>
      <p v-else-if="entries.length === 0" class="text-sm text-muted-foreground">
        No workspace found. Start by creating one.
      </p>

      <div class="grid gap-3">
        <WorkspaceCard
          v-for="entry in entries"
          :key="entry.id"
          :entry="entry"
          @open="openWorkspace"
        />
      </div>
    </section>
  </AppLayout>
</template>
