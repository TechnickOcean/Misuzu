<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue"
import { useRoute, useRouter } from "vue-router"
import type { PromptMode } from "@shared/protocol.ts"
import { BotIcon, HomeIcon, PlusIcon } from "lucide-vue-next"
import ThemeToggle from "@/components/ThemeToggle.vue"
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
import AgentChatPanel from "@/components/workspace/AgentChatPanel.vue"
import { useSolverWorkspace } from "@/composables/use-solver-workspace.ts"

const route = useRoute()
const router = useRouter()

const workspaceId = String(route.params.id)
const solver = useSolverWorkspace(workspaceId)

const sending = ref(false)

const snapshot = computed(() => solver.snapshot.value)
const state = computed(() => solver.state.value)

onMounted(async () => {
  await solver.open()
})

onUnmounted(() => {
  solver.disconnect()
})

async function sendPrompt(payload: { prompt: string; mode: PromptMode }) {
  sending.value = true
  try {
    await solver.prompt(payload.prompt, payload.mode)
  } finally {
    sending.value = false
  }
}

function openHome() {
  void router.push({ name: "home" })
}

function openCreateWorkspace() {
  void router.push({ name: "workspace-create" })
}
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
