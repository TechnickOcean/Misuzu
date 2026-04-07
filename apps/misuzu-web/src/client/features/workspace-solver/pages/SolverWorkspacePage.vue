<script setup lang="ts">
import { BotIcon, HomeIcon, PlusIcon } from "lucide-vue-next"
import { Badge } from "@/components/ui/badge"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
} from "@/components/ui/sidebar"
import { useSolverWorkspacePage } from "@/features/workspace-solver/composables/use-solver-workspace-page.ts"
import AgentChatPanel from "@/widgets/chat/AgentChatPanel.vue"
import ThemeToggle from "@/widgets/theme/ThemeToggle.vue"

const { workspaceId, snapshot, state, sending, sendPrompt, openHome, openCreateWorkspace } =
  useSolverWorkspacePage()
</script>

<template>
  <SidebarProvider class="min-h-screen">
    <Sidebar variant="inset" collapsible="none" class="border-r border-sidebar-border/70">
      <SidebarHeader>
        <div class="px-2 py-1">
          <p class="text-sm font-semibold tracking-[0.22em]">MISUZU</p>
          <p class="text-[11px] text-sidebar-foreground/70">web console</p>
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton :is-active="true">
              <BotIcon />
              <span>Solver Chat</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarSeparator />

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <div
              class="space-y-1 rounded-md border border-sidebar-border/80 bg-sidebar-accent/30 p-2 text-xs"
            >
              <p class="truncate">{{ snapshot?.rootDir ?? workspaceId }}</p>
              <p>Model: {{ snapshot?.modelId ?? "No model" }}</p>
              <p>Messages: {{ state?.messages.length ?? 0 }}</p>
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
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
          <SidebarMenuItem>
            <ThemeToggle sidebar />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>

    <SidebarInset>
      <header class="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div class="flex min-w-0 items-center gap-2">
          <p class="truncate text-sm font-semibold">Standalone Solver Agent</p>
        </div>

        <Badge variant="secondary">{{ snapshot?.modelId ?? "No model" }}</Badge>
      </header>

      <section class="min-h-0 flex-1 overflow-hidden px-3 py-3 md:px-4">
        <AgentChatPanel
          title="Standalone Solver Agent"
          :state="state"
          :loading="sending"
          @prompt="sendPrompt"
        />
      </section>
    </SidebarInset>
  </SidebarProvider>
</template>
