<script setup lang="ts">
import { Moon, Sun } from "lucide-vue-next"
import { Button } from "@/components/ui/button"
import { useThemeMode } from "@/composables/use-theme-mode.ts"

const { isDark, toggleTheme } = useThemeMode()
</script>

<template>
  <Button variant="outline" size="sm" class="gap-2" @click="toggleTheme">
    <Sun v-if="isDark" class="size-4" />
    <Moon v-else class="size-4" />
    <span>{{ isDark ? "Light" : "Dark" }}</span>
  </Button>
</template>
