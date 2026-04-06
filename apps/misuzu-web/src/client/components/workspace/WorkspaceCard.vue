<script setup lang="ts">
import type { WorkspaceRegistryEntry } from "../../../shared/protocol.ts"
import Badge from "../ui/Badge.vue"
import Card from "../ui/Card.vue"
import Button from "../ui/Button.vue"

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
  <Card class="workspace-card">
    <header class="workspace-card__header">
      <div>
        <h3>{{ entry.name }}</h3>
        <p>{{ entry.rootDir }}</p>
      </div>
      <Badge :tone="entry.kind === 'ctf-runtime' ? 'success' : 'neutral'">
        {{ entry.kind }}
      </Badge>
    </header>

    <p v-if="entry.kind === 'ctf-runtime'" class="workspace-card__meta">
      Runtime: {{ entry.runtime?.initialized ? "Initialized" : "Pending" }} · Plugin:
      {{ entry.runtime?.pluginId ?? "N/A" }}
    </p>

    <footer class="workspace-card__footer">
      <small>Updated: {{ new Date(entry.updatedAt).toLocaleString() }}</small>
      <Button variant="outline" @click="openWorkspace">Open</Button>
    </footer>
  </Card>
</template>
