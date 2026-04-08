<script setup lang="ts">
import { ref } from "vue"
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from "reka-ui"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import ModelPoolUtilizationStats from "@/features/workspace-runtime/components/ModelPoolUtilizationStats.vue"
import PlatformPluginForm from "@/features/workspace-runtime/components/PlatformPluginForm.vue"
import ChallengeListItem from "@/features/workspace-runtime/components/ChallengeListItem.vue"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import EmptyPlaceholder from "@/components/ui/empty-placeholder/EmptyPlaceholder.vue"
import { useRuntimeOverviewPage } from "@/features/workspace-runtime/composables/use-runtime-overview-page.ts"
import { Activity, TriangleAlert } from "lucide-vue-next"

const props = defineProps<{
  workspaceId: string
}>()

const {
  snapshot,
  loading,
  activeChallenges,
  queuedChallenges,
  solvedChallenges,
  blockedChallenges,
  solvedCount,
  solveRatePercent,
  selectedPluginId,
  pluginDraft,
  initError,
  initNotice,
  queueActionChallengeId,
  queueActionError,
  queueActionNotice,
  writeupExporting,
  writeupExportError,
  writeupExportNotice,
  markSolvedChallengeId,
  markSolvedError,
  markSolvedNotice,
  markSolvedPromptOpen,
  markSolvedPromptChallenge,
  initializeRuntime,
  openSolverAgent,
  badgeVariantForStatus,
  enqueueChallenge,
  dequeueChallenge,
  resetSolver,
  blockSolver,
  unblockSolver,
  exportWriteups,
  markSolverSolved,
  confirmMarkSolvedPrompt,
  dismissMarkSolvedPrompt,
} = useRuntimeOverviewPage(props.workspaceId)

const writeupUploadInput = ref<HTMLInputElement>()
const pendingMarkSolvedChallengeId = ref<number>()

function requestMarkSolvedUpload(challengeId: number) {
  pendingMarkSolvedChallengeId.value = challengeId
  writeupUploadInput.value?.click()
}

async function markSolvedDirect(challengeId: number) {
  await markSolverSolved(challengeId)
}

async function handleMarkSolvedClick(challenge: { challengeId: number; hasWriteup?: boolean }) {
  if (challenge.hasWriteup) {
    await markSolvedDirect(challenge.challengeId)
    return
  }

  requestMarkSolvedUpload(challenge.challengeId)
}

async function onWriteupUpload(event: Event) {
  const input = event.target as HTMLInputElement
  const challengeId = pendingMarkSolvedChallengeId.value
  const file = input.files?.[0]

  input.value = ""
  pendingMarkSolvedChallengeId.value = undefined

  if (challengeId === undefined || !file) {
    return
  }

  try {
    const markdown = await file.text()
    await markSolverSolved(challengeId, markdown)
  } catch (error) {
    markSolvedError.value = error instanceof Error ? error.message : String(error)
  }
}
</script>

<template>
  <div class="grid gap-4">
    <DialogRoot
      :open="markSolvedPromptOpen"
      @update:open="(open) => !open && dismissMarkSolvedPrompt()"
    >
      <DialogPortal>
        <DialogOverlay class="fixed inset-0 z-40 bg-black/45 backdrop-blur-[1px]" />
        <DialogContent
          class="fixed left-1/2 top-1/2 z-50 w-[min(92vw,32rem)] -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-background p-5 shadow-2xl"
        >
          <DialogTitle class="text-base font-semibold">WriteUp Detected</DialogTitle>
          <DialogDescription class="mt-1 text-sm text-muted-foreground">
            Detected `WriteUp.md` for
            <template v-if="markSolvedPromptChallenge">
              #{{ markSolvedPromptChallenge.challengeId }} {{ markSolvedPromptChallenge.title }} ({{
                markSolvedPromptChallenge.solverId
              }})
            </template>
            . Mark it as solved now?
          </DialogDescription>
          <div class="mt-4 flex justify-end gap-2">
            <Button variant="outline" @click="dismissMarkSolvedPrompt">Later</Button>
            <Button @click="confirmMarkSolvedPrompt">Mark Solved</Button>
          </div>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>

    <input
      ref="writeupUploadInput"
      class="hidden"
      type="file"
      accept=".md,text/markdown,text/plain"
      @change="onWriteupUpload"
    />

    <section class="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Card class="hover:bg-muted/50 transition-colors">
        <CardHeader class="flex flex-row items-center justify-between pb-2 space-y-0">
          <CardTitle class="text-sm font-medium">Challenges</CardTitle>
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">{{ snapshot?.challenges.length ?? 0 }}</div>
        </CardContent>
      </Card>
      <Card class="hover:bg-muted/50 transition-colors">
        <CardHeader class="flex flex-row items-center justify-between pb-2 space-y-0">
          <CardTitle class="text-sm font-medium">Pending</CardTitle>
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">{{ snapshot?.queue.pendingTaskCount ?? 0 }}</div>
        </CardContent>
      </Card>
      <Card class="hover:bg-muted/50 transition-colors">
        <CardHeader class="flex flex-row items-center justify-between pb-2 space-y-0">
          <CardTitle class="text-sm font-medium">Busy Solvers</CardTitle>
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">{{ snapshot?.queue.busySolverCount ?? 0 }}</div>
        </CardContent>
      </Card>
      <Card class="hover:bg-muted/50 transition-colors">
        <CardHeader class="flex flex-row items-center justify-between pb-2 space-y-0">
          <CardTitle class="text-sm font-medium">Idle Solvers</CardTitle>
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">{{ snapshot?.queue.idleSolverCount ?? 0 }}</div>
        </CardContent>
      </Card>
      <Card class="hover:bg-muted/50 transition-colors">
        <CardHeader class="flex flex-row items-center justify-between pb-2 space-y-0">
          <CardTitle class="text-sm font-medium">Solved</CardTitle>
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">{{ solvedCount }}</div>
        </CardContent>
      </Card>
      <Card class="hover:bg-muted/50 transition-colors">
        <CardHeader class="flex flex-row items-center justify-between pb-2 space-y-0">
          <CardTitle class="text-sm font-medium">Solve Rate</CardTitle>
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">{{ solveRatePercent }}%</div>
        </CardContent>
      </Card>
    </section>

    <ModelPoolUtilizationStats :model-pool="snapshot?.modelPool" />

    <Card v-if="snapshot && !snapshot.initialized">
      <CardHeader>
        <CardTitle>Initialize Runtime Plugin</CardTitle>
        <CardDescription>
          Runtime is in no-plugin mode. Configure adapter credentials below and bootstrap platform
          sync.
        </CardDescription>
      </CardHeader>
      <CardContent class="grid gap-4">
        <PlatformPluginForm v-model:plugin-id="selectedPluginId" :plugin-draft="pluginDraft" />

        <div class="flex items-center gap-2">
          <Button @click="initializeRuntime">Initialize Runtime</Button>
          <p v-if="initError" class="text-sm text-destructive">{{ initError }}</p>
        </div>
        <p v-if="initNotice" class="text-sm text-muted-foreground">{{ initNotice }}</p>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>Challenge Queue</CardTitle>
            <CardDescription>
              Ordered as active first, queued (collapsed), then solved and blocked review lists.
            </CardDescription>
          </div>
          <Button variant="outline" :disabled="writeupExporting" @click="exportWriteups">
            {{ writeupExporting ? "Exporting..." : "Export Writeups" }}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div class="space-y-4">
          <section v-if="activeChallenges.length" class="space-y-3">
            <h3
              class="text-sm font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2"
            >
              Active ({{ activeChallenges.length }})
            </h3>
            <ChallengeListItem
              v-for="challenge in activeChallenges"
              :key="challenge.challengeId"
              :challenge="challenge"
              :badge-variant="badgeVariantForStatus(challenge.status)"
              :queue-action-challenge-id="queueActionChallengeId"
              :mark-solved-challenge-id="markSolvedChallengeId"
              @enqueue="enqueueChallenge"
              @dequeue="dequeueChallenge"
              @reset="resetSolver"
              @block="blockSolver"
              @unblock="unblockSolver"
              @mark-solved-click="handleMarkSolvedClick"
              @open="openSolverAgent"
            />
          </section>

          <Accordion v-if="queuedChallenges.length" type="single" collapsible class="w-full">
            <AccordionItem value="queued">
              <AccordionTrigger
                class="text-sm font-medium text-muted-foreground uppercase tracking-wider py-2 hover:no-underline"
              >
                <div class="flex items-center gap-2">Queued ({{ queuedChallenges.length }})</div>
              </AccordionTrigger>
              <AccordionContent class="pt-4 pb-2">
                <div class="grid gap-3">
                  <ChallengeListItem
                    v-for="challenge in queuedChallenges"
                    :key="challenge.challengeId"
                    :challenge="challenge"
                    :badge-variant="badgeVariantForStatus(challenge.status)"
                    :queue-action-challenge-id="queueActionChallengeId"
                    :mark-solved-challenge-id="markSolvedChallengeId"
                    @enqueue="enqueueChallenge"
                    @dequeue="dequeueChallenge"
                    @reset="resetSolver"
                    @block="blockSolver"
                    @unblock="unblockSolver"
                    @mark-solved-click="handleMarkSolvedClick"
                    @open="openSolverAgent"
                  />
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          <section v-if="solvedChallenges.length" class="space-y-3">
            <h3
              class="text-sm font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2"
            >
              Solved ({{ solvedChallenges.length }})
            </h3>
            <div class="grid gap-3">
              <ChallengeListItem
                v-for="challenge in solvedChallenges"
                :key="challenge.challengeId"
                :challenge="challenge"
                :badge-variant="badgeVariantForStatus(challenge.status)"
                :queue-action-challenge-id="queueActionChallengeId"
                :mark-solved-challenge-id="markSolvedChallengeId"
                @enqueue="enqueueChallenge"
                @dequeue="dequeueChallenge"
                @reset="resetSolver"
                @block="blockSolver"
                @unblock="unblockSolver"
                @mark-solved-click="handleMarkSolvedClick"
                @open="openSolverAgent"
              />
            </div>
          </section>

          <section v-if="blockedChallenges.length" class="space-y-3">
            <h3
              class="text-sm font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2"
            >
              Blocked / Waiting ({{ blockedChallenges.length }})
            </h3>
            <div class="grid gap-3">
              <ChallengeListItem
                v-for="challenge in blockedChallenges"
                :key="challenge.challengeId"
                :challenge="challenge"
                :badge-variant="badgeVariantForStatus(challenge.status)"
                :queue-action-challenge-id="queueActionChallengeId"
                :mark-solved-challenge-id="markSolvedChallengeId"
                @enqueue="enqueueChallenge"
                @dequeue="dequeueChallenge"
                @reset="resetSolver"
                @block="blockSolver"
                @unblock="unblockSolver"
                @mark-solved-click="handleMarkSolvedClick"
                @open="openSolverAgent"
              />
            </div>
          </section>

          <div v-if="loading" class="space-y-4 py-2">
            <Skeleton class="h-24 w-full rounded-md" />
            <Skeleton class="h-24 w-full rounded-md" />
          </div>

          <EmptyPlaceholder
            v-else-if="(snapshot?.challenges.length ?? 0) === 0"
            title="No challenges"
            description="No challenges loaded yet. Run challenge sync first."
          />

          <Alert v-if="queueActionError" variant="destructive">
            <TriangleAlert class="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{{ queueActionError }}</AlertDescription>
          </Alert>
          <Alert v-if="queueActionNotice">
            <Activity class="h-4 w-4" />
            <AlertTitle>Notice</AlertTitle>
            <AlertDescription>{{ queueActionNotice }}</AlertDescription>
          </Alert>

          <Alert v-if="writeupExportError" variant="destructive">
            <TriangleAlert class="h-4 w-4" />
            <AlertTitle>Export Error</AlertTitle>
            <AlertDescription>{{ writeupExportError }}</AlertDescription>
          </Alert>
          <Alert v-if="writeupExportNotice">
            <Activity class="h-4 w-4" />
            <AlertTitle>Exporting</AlertTitle>
            <AlertDescription>{{ writeupExportNotice }}</AlertDescription>
          </Alert>

          <Alert v-if="markSolvedError" variant="destructive">
            <TriangleAlert class="h-4 w-4" />
            <AlertTitle>Mark Solved Error</AlertTitle>
            <AlertDescription>{{ markSolvedError }}</AlertDescription>
          </Alert>
          <Alert v-if="markSolvedNotice">
            <Activity class="h-4 w-4" />
            <AlertTitle>Notice</AlertTitle>
            <AlertDescription>{{ markSolvedNotice }}</AlertDescription>
          </Alert>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
