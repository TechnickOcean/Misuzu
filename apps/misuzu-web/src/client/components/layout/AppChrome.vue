<script setup lang="ts">
import { computed } from "vue"
import { useRoute, useRouter } from "vue-router"
import ThemeToggle from "@/components/ThemeToggle.vue"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"

const route = useRoute()
const router = useRouter()

const breadcrumbs = computed(() => {
  return route.matched
    .map((record) => ({
      label: typeof record.meta.breadcrumb === "string" ? record.meta.breadcrumb : undefined,
      path: record.path,
    }))
    .filter((item): item is { label: string; path: string } => Boolean(item.label))
})

function isActiveRoute(routeName: string) {
  return route.name === routeName
}
</script>

<template>
  <main class="mx-auto min-h-screen w-full max-w-6xl space-y-6 px-4 py-6 md:px-6">
    <header class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <p class="text-sm font-semibold tracking-[0.22em]">MISUZU</p>
          <span class="text-xs text-muted-foreground">web console</span>
        </div>

        <div class="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            :class="{ 'bg-secondary': isActiveRoute('home') }"
            @click="router.push({ name: 'home' })"
          >
            Home
          </Button>
          <Button
            variant="ghost"
            size="sm"
            :class="{ 'bg-secondary': isActiveRoute('workspace-create') }"
            @click="router.push({ name: 'workspace-create' })"
          >
            New Workspace
          </Button>
          <ThemeToggle />
        </div>
      </div>

      <div
        v-if="breadcrumbs.length > 0"
        class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
      >
        <template v-for="(item, index) in breadcrumbs" :key="`${item.path}:${item.label}`">
          <span>{{ item.label }}</span>
          <span v-if="index < breadcrumbs.length - 1">/</span>
        </template>
      </div>

      <Separator />
    </header>

    <slot />
  </main>
</template>
