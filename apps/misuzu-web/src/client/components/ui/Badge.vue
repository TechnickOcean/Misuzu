<script setup lang="ts">
import { computed } from "vue"

const props = withDefaults(
  defineProps<{
    tone?: "neutral" | "success" | "warning" | "danger"
  }>(),
  {
    tone: "neutral",
  },
)

const classes = computed(() => ({
  "ui-badge": true,
  "ui-badge--neutral": props.tone === "neutral",
  "ui-badge--success": props.tone === "success",
  "ui-badge--warning": props.tone === "warning",
  "ui-badge--danger": props.tone === "danger",
}))
</script>

<template>
  <span :class="classes">
    <slot />
  </span>
</template>
