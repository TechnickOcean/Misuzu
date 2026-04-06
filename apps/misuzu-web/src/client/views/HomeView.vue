<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue"
import { useRouter } from "vue-router"
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
import WorkspaceCard from "@/components/workspace/WorkspaceCard.vue"
import { useAppServices } from "@/di/app-services.ts"
import { useWorkspaceRegistryStore } from "@/stores/workspace-registry.ts"
import AppLayout from "@/components/layout/AppLayout.vue"

const router = useRouter()
const appServices = useAppServices()

const registryStore = useWorkspaceRegistryStore()
registryStore.bindServices(appServices)

const runtimeCount = computed(
  () => registryStore.entries.filter((entry) => entry.kind === "ctf-runtime").length,
)
const solverCount = computed(
  () => registryStore.entries.filter((entry) => entry.kind === "solver").length,
)
const initializedRuntimeCount = computed(
  () =>
    registryStore.entries.filter(
      (entry) => entry.kind === "ctf-runtime" && entry.runtime?.initialized,
    ).length,
)
const pendingRuntimeCount = computed(() => runtimeCount.value - initializedRuntimeCount.value)

const latestWorkspace = computed(() => registryStore.entries[0])

onMounted(async () => {
  await registryStore.loadEntries()
  registryStore.connectRegistryFeed()
})

onUnmounted(() => {
  registryStore.disconnectRegistryFeed()
})

async function openWorkspace(workspaceId: string, kind: "ctf-runtime" | "solver") {
  if (kind === "ctf-runtime") {
    await router.push({
      name: "runtime-overview",
      params: {
        id: workspaceId,
      },
    })
    return
  }

  await router.push({
    name: "solver",
    params: {
      id: workspaceId,
    },
  })
}

function openCreateWorkspace() {
  void router.push({ name: "workspace-create" })
}
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
              <SidebarMenuButton @click="registryStore.loadEntries">
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
              <p class="mt-1 text-sm font-semibold">{{ registryStore.entries.length }}</p>
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
          <span>{{ registryStore.entries.length }} Registry Entries</span>
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
      <Badge variant="secondary">{{ registryStore.entries.length }} entries</Badge>
    </header>

    <section class="space-y-3 px-3 py-3 md:px-4">
      <p v-if="registryStore.loading" class="text-sm text-muted-foreground">
        Loading workspace registry...
      </p>
      <p v-else-if="registryStore.entries.length === 0" class="text-sm text-muted-foreground">
        No workspace found. Start by creating one.
      </p>

      <div class="grid gap-3">
        <WorkspaceCard
          v-for="entry in registryStore.entries"
          :key="entry.id"
          :entry="entry"
          @open="openWorkspace"
        />
      </div>
    </section>
  </AppLayout>
</template>
