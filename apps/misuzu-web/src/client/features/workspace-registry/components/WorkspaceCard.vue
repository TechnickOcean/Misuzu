<script setup lang="ts">
import type { WorkspaceRegistryEntry } from "@shared/protocol.ts"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

const props = defineProps<{
  entry: WorkspaceRegistryEntry
}>()

const emit = defineEmits<{
  (event: "open", id: string, kind: WorkspaceRegistryEntry["kind"]): void
}>()

function openWorkspace() {
  emit("open", props.entry.id, props.entry.kind)
}
</script>

<template>
  <Card class="border-border/70 bg-card/80">
    <CardHeader class="flex items-start justify-between gap-2 sm:flex-row">
      <div>
        <CardTitle class="text-base">{{ entry.name }}</CardTitle>
        <CardDescription class="mt-1 break-all text-xs">{{ entry.rootDir }}</CardDescription>
      </div>
      <Badge :variant="entry.kind === 'ctf-runtime' ? 'default' : 'secondary'">
        {{ entry.kind }}
      </Badge>
    </CardHeader>

    <CardContent class="pt-0">
      <p v-if="entry.kind === 'ctf-runtime'" class="text-xs text-muted-foreground">
        Runtime: {{ entry.runtime?.initialized ? "Initialized" : "Pending" }} · Plugin:
        {{ entry.runtime?.pluginId ?? "N/A" }}
      </p>
    </CardContent>

    <CardFooter class="flex items-center justify-between">
      <small class="text-xs text-muted-foreground">
        Updated: {{ new Date(entry.updatedAt).toLocaleString() }}
      </small>
      <Button variant="outline" @click="openWorkspace">Open</Button>
    </CardFooter>
  </Card>
</template>
