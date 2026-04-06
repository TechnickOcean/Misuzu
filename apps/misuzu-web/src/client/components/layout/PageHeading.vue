<script setup lang="ts">
defineProps<{
  title: string
  description?: string
}>()
</script>

<template>
  <section class="flex flex-wrap items-start justify-between gap-3">
    <div class="space-y-1">
      <h1 class="text-3xl font-semibold tracking-tight md:text-4xl">{{ title }}</h1>
      <p v-if="description" class="max-w-3xl text-sm text-muted-foreground md:text-base">
        {{ description }}
      </p>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <slot name="actions" />
    </div>
  </section>
</template>
