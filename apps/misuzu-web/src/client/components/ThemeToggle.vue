<script setup lang="ts">
import { Moon, Sun } from "lucide-vue-next"
import { Button } from "@/components/ui/button"
import { SidebarMenuButton } from "@/components/ui/sidebar"
import { useThemeMode } from "@/composables/use-theme-mode.ts"

withDefaults(
  defineProps<{
    iconOnly?: boolean
    sidebar?: boolean
  }>(),
  {
    iconOnly: false,
    sidebar: false,
  },
)

const { isDark, toggleTheme } = useThemeMode()
</script>

<template>
  <SidebarMenuButton v-if="sidebar" @click="toggleTheme">
    <Sun v-if="isDark" />
    <Moon v-else />
    <span>{{ isDark ? "Light Mode" : "Dark Mode" }}</span>
  </SidebarMenuButton>

  <Button
    v-else
    :variant="iconOnly ? 'ghost' : 'outline'"
    :size="iconOnly ? 'icon' : 'sm'"
    :class="iconOnly ? '' : 'gap-2'"
    @click="toggleTheme"
  >
    <Sun v-if="isDark" class="size-4" />
    <Moon v-else class="size-4" />
    <span v-if="!iconOnly">{{ isDark ? "Light" : "Dark" }}</span>
    <span v-else class="sr-only">Toggle theme</span>
  </Button>
</template>
