<script setup lang="ts">
import { Moon, Sun } from "lucide-vue-next"
import { Button } from "@/components/ui/button"
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
  <Button
    :variant="iconOnly || sidebar ? 'ghost' : 'outline'"
    :size="iconOnly ? 'icon' : sidebar ? 'default' : 'sm'"
    :class="iconOnly ? '' : sidebar ? 'w-full justify-start gap-2' : 'gap-2'"
    @click="toggleTheme"
  >
    <Sun v-if="isDark" class="size-4" />
    <Moon v-else class="size-4" />
    <span v-if="!iconOnly">{{ isDark ? "Light" : "Dark" }}</span>
    <span v-else class="sr-only">Toggle theme</span>
  </Button>
</template>
