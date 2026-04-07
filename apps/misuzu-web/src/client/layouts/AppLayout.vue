<script setup lang="ts">
import { useMediaQuery } from "@vueuse/core"
import ThemeToggle from "@/widgets/theme/ThemeToggle.vue"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
} from "@/components/ui/sidebar"

const isNarrow = useMediaQuery("(max-width: 1024px)")
</script>

<template>
  <SidebarProvider class="h-screen overflow-hidden">
    <Sidebar
      variant="inset"
      :collapsible="isNarrow ? 'icon' : 'none'"
      class="border-r border-sidebar-border/70 flex-shrink-0"
    >
      <SidebarHeader>
        <div class="px-2 py-1">
          <p class="text-sm font-semibold tracking-[0.22em]">MISUZU</p>
          <p class="text-[11px] text-sidebar-foreground/70">web console</p>
        </div>
        <slot name="header-menu" />
      </SidebarHeader>

      <SidebarSeparator />

      <SidebarContent>
        <slot name="sidebar-content" />
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <slot name="footer-menu" />
          <SidebarMenuItem>
            <ThemeToggle sidebar />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>

    <SidebarInset>
      <slot />
    </SidebarInset>
  </SidebarProvider>
</template>
