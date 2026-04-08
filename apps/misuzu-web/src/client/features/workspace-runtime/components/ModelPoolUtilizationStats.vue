<script setup lang="ts">
import { computed } from "vue"
import type { ModelPoolSnapshot } from "@shared/protocol.ts"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

const props = defineProps<{
  modelPool?: ModelPoolSnapshot
}>()

const poolItems = computed(() => props.modelPool?.items ?? [])
const totalCapacity = computed(() => props.modelPool?.totalCapacity ?? 0)
const totalInUse = computed(() => props.modelPool?.totalInUse ?? 0)
const totalAvailable = computed(() => props.modelPool?.totalAvailable ?? 0)

const utilizationPercent = computed(() => {
  if (totalCapacity.value <= 0) {
    return 0
  }

  return Math.min(100, Math.round((totalInUse.value / totalCapacity.value) * 100))
})

function itemUtilizationPercent(inUse: number, maxConcurrency: number) {
  if (maxConcurrency <= 0) {
    return 0
  }

  return Math.min(100, Math.round((inUse / maxConcurrency) * 100))
}

function utilizationBarClass(percent: number) {
  if (percent >= 90) {
    return "bg-destructive"
  }

  if (percent >= 70) {
    return "bg-amber-500"
  }

  return "bg-emerald-500"
}
</script>

<template>
  <Card>
    <CardHeader>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle>Model Pool Utilization</CardTitle>
          <CardDescription
            >Current model concurrency occupancy across runtime pool.</CardDescription
          >
        </div>
        <Badge variant="outline">{{ utilizationPercent }}%</Badge>
      </div>
    </CardHeader>

    <CardContent class="space-y-4">
      <div class="space-y-1.5">
        <div class="flex items-center justify-between text-xs text-muted-foreground">
          <span>In use {{ totalInUse }} / {{ totalCapacity }}</span>
          <span>Available {{ totalAvailable }}</span>
        </div>
        <div class="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            :class="['h-full transition-all', utilizationBarClass(utilizationPercent)]"
            :style="{ width: `${utilizationPercent}%` }"
          ></div>
        </div>
      </div>

      <div v-if="poolItems.length" class="grid gap-3 md:grid-cols-2">
        <article
          v-for="(item, index) in poolItems"
          :key="`${item.provider}:${item.modelId}:${String(index)}`"
          class="space-y-2 rounded-md border p-3"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="truncate text-sm font-medium">{{ item.provider }}</p>
              <p class="truncate text-xs text-muted-foreground">{{ item.modelId }}</p>
            </div>
            <Badge v-if="!item.modelResolved" variant="outline">unresolved</Badge>
          </div>

          <div class="space-y-1">
            <div class="flex items-center justify-between text-xs text-muted-foreground">
              <span>{{ item.inUse }} / {{ item.maxConcurrency }}</span>
              <span>{{ item.available }} free</span>
            </div>
            <div class="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                :class="[
                  'h-full transition-all',
                  utilizationBarClass(itemUtilizationPercent(item.inUse, item.maxConcurrency)),
                ]"
                :style="{ width: `${itemUtilizationPercent(item.inUse, item.maxConcurrency)}%` }"
              ></div>
            </div>
          </div>
        </article>
      </div>

      <p v-else class="text-sm text-muted-foreground">No model pool configured yet.</p>
    </CardContent>
  </Card>
</template>
