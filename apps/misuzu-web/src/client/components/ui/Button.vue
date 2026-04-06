<script setup lang="ts">
import { computed } from "vue"

type ButtonVariant = "default" | "outline" | "ghost" | "danger"

const props = withDefaults(
  defineProps<{
    variant?: ButtonVariant
    disabled?: boolean
    type?: "button" | "submit" | "reset"
  }>(),
  {
    variant: "default",
    disabled: false,
    type: "button",
  },
)

const classes = computed(() => {
  return {
    "ui-button": true,
    "ui-button--default": props.variant === "default",
    "ui-button--outline": props.variant === "outline",
    "ui-button--ghost": props.variant === "ghost",
    "ui-button--danger": props.variant === "danger",
  }
})
</script>

<template>
  <button :type="type" :disabled="disabled" :class="classes">
    <slot />
  </button>
</template>
