<script setup lang="ts">
import { computed } from "vue"

const props = defineProps<{
  title?: string
  description?: string
}>()
</script>

<template>
  <div
    class="mx-auto mt-8 grid w-full max-w-2xl gap-2 rounded-xl border border-dashed bg-muted/20 px-5 py-7 text-center"
  >
    <p v-if="title || $slots.title" class="text-sm font-medium">
      <slot name="title">{{ title }}</slot>
    </p>
    <p v-if="description || $slots.description" class="text-xs text-muted-foreground">
      <slot name="description">{{ description }}</slot>
    </p>
    <slot />
  </div>
</template>
