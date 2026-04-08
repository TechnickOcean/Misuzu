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
        <div class="px-2 py-2 mb-1">
          <p class="text-base font-bold tracking-widest text-primary">MISUZU</p>
          <p
            class="text-[10px] text-sidebar-foreground/60 uppercase tracking-wider mt-0.5 font-medium"
          >
            web console
          </p>
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
          <SidebarGroupLabel>Workspace Details</SidebarGroupLabel>
          <SidebarGroupContent>
            <div
              class="flex flex-col gap-3 rounded-lg border border-sidebar-border/50 bg-sidebar-accent/40 p-3 text-xs shadow-sm mt-1"
            >
              <div class="space-y-1">
                <span
                  class="text-sidebar-foreground/60 font-medium uppercase tracking-wider text-[10px]"
                  >Directory</span
                >
                <p class="truncate font-medium" :title="snapshot?.rootDir ?? workspaceId">
                  {{ snapshot?.rootDir ?? workspaceId }}
                </p>
              </div>
              <div class="space-y-1">
                <span
                  class="text-sidebar-foreground/60 font-medium uppercase tracking-wider text-[10px]"
                  >Model</span
                >
                <p class="font-medium">{{ snapshot?.modelId ?? "No model" }}</p>
              </div>
              <div class="space-y-1">
                <span
                  class="text-sidebar-foreground/60 font-medium uppercase tracking-wider text-[10px]"
                  >Messages</span
                >
                <p class="font-medium">{{ state?.messages.length ?? 0 }}</p>
              </div>
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
      <header
        class="sticky top-0 z-10 flex h-14 items-center justify-between gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60 shadow-sm"
      >
        <div class="flex min-w-0 items-center gap-2.5">
          <div class="rounded-md bg-primary/10 p-1.5">
            <BotIcon class="h-4 w-4 text-primary" />
          </div>
          <h1 class="truncate text-sm font-semibold tracking-tight">Standalone Solver Agent</h1>
        </div>

        <Badge variant="secondary" class="font-mono text-xs shadow-sm">{{
          snapshot?.modelId ?? "No model"
        }}</Badge>
      </header>

      <section class="min-h-0 flex-1 overflow-hidden px-3 py-3 md:px-4">
        <AgentChatPanel
          :key="String(workspaceId)"
          title="Standalone Solver Agent"
          :state="state"
          :loading="sending"
          @prompt="sendPrompt"
        />
      </section>
    </SidebarInset>
  </SidebarProvider>
</template>
