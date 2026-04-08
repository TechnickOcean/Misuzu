<script setup lang="ts">
import { computed } from "vue"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { MoreHorizontal } from "lucide-vue-next"
import type { CtfRuntimeStateChallenge } from "@misuzu/core/application/workspace/ctf-runtime/state"

const props = defineProps<{
  challenge: CtfRuntimeStateChallenge
  badgeVariant: string
  queueActionChallengeId?: number
  markSolvedChallengeId?: number
}>()

const emit = defineEmits<{
  enqueue: [challengeId: number]
  dequeue: [challengeId: number]
  reset: [challengeId: number]
  block: [challengeId: number]
  unblock: [challengeId: number]
  markSolvedClick: [challenge: CtfRuntimeStateChallenge]
  open: [solverId: string]
}>()

const isQueueActionDisabled = computed(
  () => props.queueActionChallengeId === props.challenge.challengeId,
)
const isMarking = computed(() => props.markSolvedChallengeId === props.challenge.challengeId)

function onEnqueue() {
  emit("enqueue", props.challenge.challengeId)
}
function onDequeue() {
  emit("dequeue", props.challenge.challengeId)
}
function onReset() {
  emit("reset", props.challenge.challengeId)
}
function onBlock() {
  emit("block", props.challenge.challengeId)
}
function onUnblock() {
  emit("unblock", props.challenge.challengeId)
}
function onMarkSolved() {
  emit("markSolvedClick", props.challenge)
}
function onOpen() {
  emit("open", props.challenge.solverId)
}
</script>

<template>
  <article
    class="flex flex-col rounded-lg border bg-card text-card-foreground shadow-sm transition-colors"
  >
    <div class="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div class="space-y-1">
        <div class="flex items-center gap-2">
          <h4 class="text-base font-semibold leading-none tracking-tight">
            #{{ challenge.challengeId }} {{ challenge.title }}
          </h4>
          <Badge :variant="badgeVariant">{{ challenge.status }}</Badge>
        </div>
        <p class="text-sm text-muted-foreground flex items-center gap-1.5 flex-wrap">
          <span class="font-medium">{{ challenge.category }}</span>
          <span>·</span>
          <span>{{ challenge.score }} pts</span>
          <span>·</span>
          <span>solved {{ challenge.solvedCount }}</span>
          <template v-if="typeof challenge.rank === 'number'">
            <span>·</span>
            <span>rank {{ Math.round(challenge.rank) }}</span>
          </template>
        </p>
        <p
          v-if="challenge.statusReason"
          class="text-xs text-muted-foreground mt-1 bg-muted/50 p-1.5 rounded-md"
        >
          {{ challenge.statusReason }}
        </p>
      </div>

      <div class="flex items-center gap-2 self-start sm:self-auto">
        <Button
          v-if="challenge.status !== 'model_unassigned'"
          variant="default"
          size="sm"
          @click="onOpen"
        >
          Open Console
        </Button>

        <Button
          v-if="challenge.status !== 'solved'"
          variant="secondary"
          size="sm"
          :disabled="isMarking"
          @click="onMarkSolved"
        >
          {{ isMarking ? "Marking..." : challenge.hasWriteup ? "Mark Solved" : "Upload WP" }}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="icon" class="h-8 w-8">
              <MoreHorizontal class="h-4 w-4" />
              <span class="sr-only">Open menu</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-48">
            <DropdownMenuLabel>Solver Actions</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              :disabled="isQueueActionDisabled || challenge.manuallyBlocked"
              @click="onEnqueue"
            >
              Enqueue Task
            </DropdownMenuItem>
            <DropdownMenuItem :disabled="isQueueActionDisabled" @click="onDequeue">
              Dequeue Task
            </DropdownMenuItem>
            <DropdownMenuItem :disabled="isQueueActionDisabled" @click="onReset">
              Reset Solver
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              v-if="!challenge.manuallyBlocked"
              class="text-destructive focus:text-destructive focus:bg-destructive/10"
              :disabled="isQueueActionDisabled"
              @click="onBlock"
            >
              Block Solver
            </DropdownMenuItem>
            <DropdownMenuItem v-else :disabled="isQueueActionDisabled" @click="onUnblock">
              Unblock Solver
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  </article>
</template>
